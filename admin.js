// ===== Supabase 연결 정보 (공개 키만) =====
const SUPABASE_URL = "https://wjngtblwxhzdetoqgifd.supabase.co";
const SUPABASE_KEY = "sb_publishable_61IBV0rCL22aTOIz6mv2iA_AwoJfIkm";
const BUCKET = "resume";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const FILE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

// ===== 작은 도우미 =====
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const b = el("button", "btn " + (className || ""), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function setStatus(id, text, isError) {
  const node = $(id);
  node.textContent = text || "";
  node.classList.toggle("error", !!isError);
}

function isSafeUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function formatDate(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// 버튼을 누르는 동안 다시 못 누르게 하고, 실패하면 안내 문구를 보여 준다
async function busy(btn, statusId, work) {
  btn.disabled = true;
  try {
    await work();
  } catch (e) {
    setStatus(statusId, e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ===== 로그인 정보 (브라우저에 저장) =====
let session = null;

function loadSession() {
  try { session = JSON.parse(localStorage.getItem("resume_admin_session")); } catch (e) { session = null; }
}

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    email: data.user ? data.user.email : (session && session.email),
  };
  try { localStorage.setItem("resume_admin_session", JSON.stringify(session)); } catch (e) { /* 저장 못 해도 이번 화면에서는 동작 */ }
}

function clearSession() {
  session = null;
  try { localStorage.removeItem("resume_admin_session"); } catch (e) { /* 무시 */ }
}

// Supabase Auth 에 요청 (로그인·토큰 새로 받기·로그아웃)
async function auth(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error("auth " + res.status);
  return res.status === 204 ? null : res.json();
}

// 쓸 수 있는 토큰을 돌려준다. 곧 끝나면 새로 받는다.
async function getToken() {
  if (!session) throw new Error("로그인이 필요해요.");
  if (session.expires_at - 60 < Date.now() / 1000) {
    try {
      saveSession(await auth("token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
    } catch (e) {
      clearSession();
      showLogin("로그인 시간이 끝났어요. 다시 로그인해 주세요.");
      throw new Error("로그인 시간이 끝났어요.");
    }
  }
  return session.access_token;
}

// 로그인한 토큰으로 요청을 보낸다
async function authFetch(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token, ...(options.headers || {}) },
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) { /* 내용 없음 */ }
    throw new Error("요청이 실패했어요 (" + res.status + ") " + detail);
  }
  return res;
}

// 표(REST)에 요청
async function db(path, options = {}) {
  const res = await authFetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 카드 하나의 좋아요 수
async function countLikes(projectId) {
  const res = await authFetch(SUPABASE_URL + "/rest/v1/likes?select=id&project_id=eq." + projectId, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1]) || 0;
}

// ===== 파일 올리기 =====

// 올릴 수 있는 파일인지 확인. 안 되면 이유를 알려 준다.
function checkFile(file, allowPdf) {
  if (!file) return null;
  const ext = FILE_TYPES[file.type];
  if (!ext || (ext === "pdf" && !allowPdf)) {
    return allowPdf
      ? "이미지(PNG·JPG·WEBP·GIF)나 PDF만 올릴 수 있어요."
      : "이미지(PNG·JPG·WEBP·GIF)만 올릴 수 있어요.";
  }
  if (file.size > MAX_SIZE) return "10MB가 넘는 파일은 올릴 수 없어요.";
  return null;
}

// 파일을 고르자마자 확인해서, 안 되는 파일이면 비우고 안내한다
function watchFileInput(inputId, allowPdf, statusId) {
  $(inputId).addEventListener("change", () => {
    const problem = checkFile($(inputId).files[0], allowPdf);
    if (problem) {
      $(inputId).value = "";
      setStatus(statusId, problem, true);
    } else {
      setStatus(statusId, "");
    }
  });
}

// resume 보관함의 folder/ 에 올리고 공개 주소를 돌려준다
async function uploadFile(folder, file, allowPdf) {
  const problem = checkFile(file, allowPdf);
  if (problem) throw new Error(problem);
  // 파일 이름은 영어·숫자로 새로 짓는다. 예: projects/20261027-153012-k3j9x2.png
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const random = Math.random().toString(36).slice(2, 8);
  const path = folder + "/" + stamp + "-" + random + "." + FILE_TYPES[file.type];

  await authFetch(SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + path, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + path;
}

// ===== 화면 바꾸기 =====
function showLogin(message) {
  $("login-view").hidden = false;
  $("top-view").hidden = true;
  $("admin-view").hidden = true;
  setStatus("login-status", message || "");
}

async function showApp() {
  $("login-view").hidden = true;
  $("top-view").hidden = false;
  $("user-email").textContent = session.email || "";
  $("not-admin").hidden = true;
  $("admin-view").hidden = true;

  let isAdmin = false;
  try {
    // admins 표는 자기 줄만 보인다. 줄이 있으면 관리자.
    const rows = await db("admins?select=user_id");
    isAdmin = rows.length > 0;
  } catch (e) {
    if (!session) return; // 로그인 시간이 끝나 로그인 화면으로 돌아감
    isAdmin = false;
  }

  if (!isAdmin) {
    $("not-admin").hidden = false;
    return;
  }
  $("admin-view").hidden = false;
  loadProfile();
  loadProjects();
  loadGuestbook();
}

// ===== 로그인·로그아웃 =====
async function login() {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    setStatus("login-status", "이메일과 비밀번호를 모두 적어 주세요.", true);
    return;
  }
  setStatus("login-status", "로그인 중…");
  try {
    saveSession(await auth("token?grant_type=password", { email, password }));
    $("login-password").value = "";
    showApp();
  } catch (e) {
    setStatus("login-status", "이메일 또는 비밀번호가 맞지 않아요.", true);
  }
}

async function logout() {
  if (session) {
    try { await auth("logout", {}, session.access_token); } catch (e) { /* 이미 끝난 로그인이어도 괜찮음 */ }
  }
  clearSession();
  showLogin("로그아웃했어요.");
}

$("login-button").addEventListener("click", (e) => busy(e.currentTarget, "login-status", login));
$("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) login();
});
$("logout-button").addEventListener("click", logout);

// ===== 프로필 =====
const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote",
];
let profilePhotoUrl = null;

function showProfilePhoto(url) {
  profilePhotoUrl = url;
  const ok = isSafeUrl(url);
  $("pf-photo-preview").hidden = !ok;
  $("pf-photo-none").hidden = ok;
  if (ok) $("pf-photo-preview").src = url;
}

async function loadProfile() {
  try {
    const rows = await db("profile?select=*&id=eq.1");
    const p = rows[0] || {};
    PROFILE_FIELDS.forEach((f) => { $("pf-" + f).value = p[f] || ""; });
    showProfilePhoto(p.photo_url || null);
  } catch (e) {
    setStatus("pf-status", "프로필을 불러오지 못했어요. " + e.message, true);
  }
}

async function saveProfile() {
  setStatus("pf-status", "저장 중…");
  const body = { id: 1, updated_at: new Date().toISOString() };
  PROFILE_FIELDS.forEach((f) => { body[f] = $("pf-" + f).value.trim(); });

  const file = $("pf-photo").files[0];
  body.photo_url = file ? await uploadFile("profile", file, false) : profilePhotoUrl;

  // 줄이 없으면 만들고, 있으면 고친다
  const rows = await db("profile?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body,
  });
  if (!rows || rows.length === 0) throw new Error("저장되지 않았어요. 관리자로 로그인했는지 확인해 주세요.");

  $("pf-photo").value = "";
  showProfilePhoto(rows[0].photo_url);
  setStatus("pf-status", "저장했어요. 방문자 화면을 새로고침하면 보여요.");
}

$("pf-save").addEventListener("click", (e) => busy(e.currentTarget, "pf-status", saveProfile));
watchFileInput("pf-photo", false, "pf-status");

// ===== 포트폴리오 카드 =====
let projects = [];
let editingId = null;          // null 이면 새 카드
let editThumbUrl = null;
let editFileUrl = null;

async function loadProjects() {
  const list = $("pj-list");
  try {
    projects = await db("projects?select=*&order=sort_order.asc,id.asc");
  } catch (e) {
    setStatus("pj-status", "카드를 불러오지 못했어요. " + e.message, true);
    return;
  }
  list.replaceChildren();
  if (projects.length === 0) {
    list.append(el("li", "status", "아직 카드가 없어요. 아래 [카드 추가]를 눌러 주세요."));
    return;
  }
  projects.forEach((p, i) => list.append(makeProjectItem(p, i)));
}

function makeProjectItem(p, index) {
  const li = el("li", "pj-item");

  let thumb;
  if (isSafeUrl(p.thumbnail_url)) {
    thumb = el("img", "pj-thumb");
    thumb.src = p.thumbnail_url;
    thumb.alt = "";
  } else {
    thumb = el("span", "pj-thumb");
  }

  const info = el("div", "pj-info");
  const likes = el("p", "pj-likes");
  const likeNumber = el("b", "", "…");
  likes.append("♥ 좋아요 ", likeNumber);
  info.append(
    el("p", "pj-meta", [p.number, p.category].filter(Boolean).join(" · ")),
    el("p", "pj-title", p.title),
    likes
  );
  countLikes(p.id)
    .then((n) => { likeNumber.textContent = n; })
    .catch(() => { likeNumber.textContent = "-"; });

  const buttons = el("div", "pj-buttons");
  const up = button("▲ 위로", "small", (e) => busy(e.currentTarget, "pj-status", () => moveProject(index, -1)));
  const down = button("▼ 아래로", "small", (e) => busy(e.currentTarget, "pj-status", () => moveProject(index, 1)));
  up.disabled = index === 0;
  down.disabled = index === projects.length - 1;
  up.setAttribute("aria-label", p.title + " 위로");
  down.setAttribute("aria-label", p.title + " 아래로");

  buttons.append(
    up,
    down,
    button("수정", "small", () => openEditor(p)),
    button("좋아요 초기화", "small danger", (e) => busy(e.currentTarget, "pj-status", async () => {
      if (!confirm("'" + p.title + "' 카드의 좋아요를 모두 지울까요? 되돌릴 수 없어요.")) return;
      await db("likes?project_id=eq." + p.id, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      likeNumber.textContent = await countLikes(p.id);
      setStatus("pj-status", "'" + p.title + "' 좋아요를 초기화했어요.");
    })),
    button("삭제", "small danger", (e) => busy(e.currentTarget, "pj-status", async () => {
      if (!confirm("'" + p.title + "' 카드를 지울까요? 이 카드의 좋아요도 함께 지워지고, 되돌릴 수 없어요.")) return;
      const rows = await db("projects?id=eq." + p.id, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      if (!rows || rows.length === 0) throw new Error("지우지 못했어요. 관리자로 로그인했는지 확인해 주세요.");
      if (editingId === p.id) closeEditor();
      setStatus("pj-status", "'" + p.title + "' 카드를 지웠어요.");
      await loadProjects();
    }))
  );

  li.append(thumb, info, buttons);
  return li;
}

// 순서 바꾸기: 이웃 카드와 자리를 바꾼 뒤 1, 2, 3… 으로 다시 번호를 매긴다
async function moveProject(index, step) {
  const other = index + step;
  if (other < 0 || other >= projects.length) return;
  const ordered = projects.slice();
  [ordered[index], ordered[other]] = [ordered[other], ordered[index]];

  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].sort_order !== i + 1) {
      await db("projects?id=eq." + ordered[i].id, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { sort_order: i + 1 },
      });
    }
  }
  setStatus("pj-status", "순서를 바꿨어요.");
  await loadProjects();
}

// 지금 붙어 있는 썸네일·첨부 파일과 [빼기] 버튼을 보여 준다
function showCurrentFile(boxId, url, isImage, onRemove) {
  const box = $(boxId);
  box.replaceChildren();
  if (!isSafeUrl(url)) {
    box.append(el("span", "", "없음"));
    return;
  }
  if (isImage) {
    const img = el("img");
    img.src = url;
    img.alt = "";
    box.append(img);
  } else {
    const a = el("a", "", "지금 파일 열어 보기");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    box.append(a);
  }
  box.append(button("빼기", "small danger", onRemove));
}

function refreshEditorFiles() {
  showCurrentFile("pj-thumb-current", editThumbUrl, true, () => { editThumbUrl = null; refreshEditorFiles(); });
  showCurrentFile("pj-file-current", editFileUrl, false, () => { editFileUrl = null; refreshEditorFiles(); });
}

function openEditor(p) {
  editingId = p ? p.id : null;
  $("pj-editor-title").textContent = p ? "카드 수정" : "카드 추가";
  $("pj-number").value = p ? p.number : "";
  $("pj-category").value = p ? p.category : "";
  $("pj-title").value = p ? p.title : "";
  $("pj-description").value = p ? p.description : "";
  $("pj-tags").value = p ? (p.tags || []).join(", ") : "";
  $("pj-thumb").value = "";
  $("pj-file").value = "";
  editThumbUrl = p ? p.thumbnail_url : null;
  editFileUrl = p ? p.file_url : null;
  refreshEditorFiles();
  setStatus("pj-editor-status", "");
  $("pj-editor").hidden = false;
  $("pj-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  editingId = null;
  $("pj-editor").hidden = true;
}

async function saveProject() {
  const title = $("pj-title").value.trim();
  if (!title) {
    setStatus("pj-editor-status", "제목을 적어 주세요.", true);
    return;
  }
  setStatus("pj-editor-status", "저장 중…");

  const thumbFile = $("pj-thumb").files[0];
  const attachFile = $("pj-file").files[0];
  const thumbnailUrl = thumbFile ? await uploadFile("projects", thumbFile, false) : editThumbUrl;
  const fileUrl = attachFile ? await uploadFile("projects", attachFile, true) : editFileUrl;

  const body = {
    number: $("pj-number").value.trim(),
    category: $("pj-category").value.trim(),
    title,
    description: $("pj-description").value.trim(),
    tags: $("pj-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    thumbnail_url: thumbnailUrl || null,
    file_url: fileUrl || null,
  };

  let rows;
  if (editingId === null) {
    // 새 카드는 맨 뒤에 붙인다
    body.sort_order = projects.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
    rows = await db("projects", { method: "POST", headers: { Prefer: "return=representation" }, body });
  } else {
    rows = await db("projects?id=eq." + editingId, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body,
    });
  }
  if (!rows || rows.length === 0) throw new Error("저장되지 않았어요. 관리자로 로그인했는지 확인해 주세요.");

  closeEditor();
  setStatus("pj-status", "'" + title + "' 카드를 저장했어요. 방문자 화면을 새로고침하면 보여요.");
  await loadProjects();
}

$("pj-add").addEventListener("click", () => openEditor(null));
$("pj-cancel").addEventListener("click", closeEditor);
$("pj-save").addEventListener("click", (e) => busy(e.currentTarget, "pj-editor-status", saveProject));
watchFileInput("pj-thumb", false, "pj-editor-status");
watchFileInput("pj-file", true, "pj-editor-status");

// ===== 방명록 =====
async function loadGuestbook() {
  const list = $("gb-list");
  let rows;
  try {
    rows = await db("resume_guestbook?select=*&order=created_at.desc&limit=200");
  } catch (e) {
    setStatus("gb-status", "방명록을 불러오지 못했어요. " + e.message, true);
    return;
  }
  setStatus("gb-status", rows.length === 0 ? "아직 남겨진 글이 없어요." : "");
  list.replaceChildren(...rows.map(makeGuestbookItem));
}

function makeGuestbookItem(row) {
  const li = el("li");
  const text = el("div");
  const head = el("div", "gb-head");
  head.append(el("span", "gb-nick", row.nickname), el("span", "gb-date", formatDate(row.created_at)));
  text.append(head, el("p", "gb-msg", row.message));

  const del = button("삭제", "small danger", (e) => busy(e.currentTarget, "gb-status", async () => {
    if (!confirm("'" + row.nickname + "'님의 글을 지울까요? 되돌릴 수 없어요.")) return;
    const deleted = await db("resume_guestbook?id=eq." + row.id, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!deleted || deleted.length === 0) throw new Error("지우지 못했어요. 관리자로 로그인했는지 확인해 주세요.");
    li.remove();
    setStatus("gb-status", "글을 지웠어요.");
  }));

  li.append(text, del);
  return li;
}

// ===== 시작 =====
loadSession();
if (session) showApp();
else showLogin();
