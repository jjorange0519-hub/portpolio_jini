// ===== Supabase 연결 정보 (공개 키만) =====
const SUPABASE_URL = "https://wjngtblwxhzdetoqgifd.supabase.co";
const SUPABASE_KEY = "sb_publishable_61IBV0rCL22aTOIz6mv2iA_AwoJfIkm";

// Supabase 표에 요청을 보내는 함수
async function api(path, options = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    // Supabase 가 알려 준 이유(예: "비밀번호가 맞지 않아요.")가 있으면 그걸 쓴다
    let reason = "";
    try { reason = (await res.json()).message || ""; } catch (e) { /* 내용 없음 */ }
    const error = new Error(reason || "요청 실패 (" + res.status + ")");
    error.status = res.status;
    error.reason = reason;
    throw error;
  }
  return res;
}

// Supabase 함수(rpc) 부르기
async function rpc(name, body) {
  const res = await api("rpc/" + name, { method: "POST", body });
  return res.json();
}

// ===== 브라우저에 저장하는 값 (client_id, 좋아요 누른 카드) =====
function readStorage(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 저장 못 해도 화면은 동작 */ }
}

function getClientId() {
  let id = readStorage("resume_client_id");
  if (!id) {
    id = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    writeStorage("resume_client_id", id);
  }
  return id;
}

function getLikedIds() {
  try { return JSON.parse(readStorage("resume_liked") || "[]"); } catch (e) { return []; }
}
function addLikedId(projectId) {
  const ids = getLikedIds();
  if (!ids.includes(projectId)) ids.push(projectId);
  writeStorage("resume_liked", JSON.stringify(ids));
}

// ===== 작은 도우미 =====
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// http/https 주소만 연다
function isSafeUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function formatDate(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// ===== 프로필 =====
async function loadProfile() {
  try {
    const res = await api("profile?select=*&id=eq.1");
    const rows = await res.json();
    const p = rows[0];
    if (!p) return;

    $("name").textContent = p.name;
    $("job-title").textContent = p.title;
    $("career-badge").textContent = p.career_badge;
    $("contact-name").textContent = p.name;
    $("contact-email").textContent = p.email;
    $("contact-phone").textContent = p.phone;
    $("contact-location").textContent = p.location;
    $("intro").textContent = p.intro;
    $("education").textContent = p.education;
    $("skills").textContent = p.skills;
    $("experience").textContent = p.experience;
    $("quote").textContent = p.quote;
    if (p.name) document.title = p.name + " | 포트폴리오";

    // 한 줄 소개: 이름 부분에 파란 밑줄
    const headline = $("headline");
    headline.textContent = "";
    const parts = p.name ? p.headline.split(p.name) : [p.headline];
    parts.forEach((part, i) => {
      headline.append(part);
      if (i < parts.length - 1) headline.append(el("span", "underline", p.name));
    });

    // 프로필 사진 (없으면 회색 자리 그대로)
    if (isSafeUrl(p.photo_url)) {
      const img = el("img");
      img.src = p.photo_url;
      img.alt = p.name + " 프로필 사진";
      $("photo").replaceChildren(img);
    }
  } catch (e) {
    $("headline").textContent = "프로필을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.";
  }
}

// ===== 포트폴리오 카드 =====
async function countLikes(projectId) {
  const res = await api("likes?select=id&project_id=eq." + projectId, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  // 예: "0-4/5" → 5
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1]) || 0;
}

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.1 8.4 3.2 4.5 7 4.5c2.1 0 3.6 1.1 5 3 1.4-1.9 2.9-3 5-3 3.8 0 5.9 3.9 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>';

function makeCard(project) {
  const card = el("article", "card");

  // 카드 본문: 누르면 파일(없으면 썸네일)을 새 탭에서 연다
  const open = el("button", "card-open");
  open.type = "button";
  const target = isSafeUrl(project.file_url) ? project.file_url
    : isSafeUrl(project.thumbnail_url) ? project.thumbnail_url : null;
  if (target) {
    open.addEventListener("click", () => window.open(target, "_blank", "noopener"));
  } else {
    open.disabled = true;
  }

  const win = el("span", "window");
  const bar = el("span", "window-bar");
  bar.append(el("i"), el("i"), el("i"));
  const screen = el("span", "window-screen");
  if (isSafeUrl(project.thumbnail_url)) {
    const img = el("img");
    img.src = project.thumbnail_url;
    img.alt = "";
    img.loading = "lazy";
    screen.append(img);
  }
  win.append(bar, screen);

  const body = el("span", "card-body");
  const meta = [project.number, project.category].filter(Boolean).join(" · ");
  body.append(
    el("span", "card-meta", meta),
    el("span", "card-title", project.title),
    el("span", "card-desc", project.description)
  );
  const tags = el("span", "tags");
  (project.tags || []).forEach((t) => tags.append(el("span", "tag", t)));
  body.append(tags);

  open.append(win, body);

  // 좋아요 버튼
  const foot = el("div", "card-foot");
  const like = el("button", "like");
  like.type = "button";
  like.innerHTML = HEART;
  const count = el("span", "like-count", "0");
  like.append(count);
  like.setAttribute("aria-label", project.title + " 좋아요");

  const markLiked = () => {
    like.classList.add("liked");
    like.disabled = true;
  };
  if (getLikedIds().includes(project.id)) markLiked();

  countLikes(project.id)
    .then((n) => { count.textContent = n; })
    .catch(() => { count.textContent = "-"; });

  like.addEventListener("click", async () => {
    like.disabled = true;
    try {
      await api("likes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: { project_id: project.id, client_id: getClientId() },
      });
      count.textContent = (Number(count.textContent) || 0) + 1;
      addLikedId(project.id);
      markLiked();
    } catch (e) {
      if (e.status === 409) {
        // 이미 이 브라우저에서 누른 카드
        addLikedId(project.id);
        markLiked();
      } else {
        like.disabled = false;
        alert("좋아요를 남기지 못했어요. 잠시 뒤 다시 눌러 주세요.");
      }
    }
  });

  foot.append(like);
  card.append(open, foot);
  return card;
}

async function loadProjects() {
  const box = $("cards");
  try {
    const res = await api("projects?select=*&order=sort_order.asc,id.asc");
    const projects = await res.json();
    box.replaceChildren();
    if (projects.length === 0) {
      box.append(el("p", "cards-message", "아직 등록된 프로젝트가 없어요."));
      return;
    }
    projects.forEach((p) => box.append(makeCard(p)));
  } catch (e) {
    box.replaceChildren(el("p", "cards-message", "프로젝트를 불러오지 못했어요."));
  }
}

// ===== 방명록 =====
const GB_COLUMNS = "id,nickname,message,created_at,updated_at";

function gbButton(text, className, onClick) {
  const b = el("button", "gb-tool " + (className || ""), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function makeGuestbookItem(row) {
  const li = el("li");
  const head = el("div", "gb-head");
  const date = el("span", "gb-date", formatDate(row.created_at));
  const msg = el("p", "gb-msg", row.message);
  const edited = el("span", "gb-edited", row.updated_at ? "(수정됨)" : "");
  const tools = el("span", "gb-tools");
  head.append(el("span", "gb-nick", row.nickname), date, edited, tools);
  li.append(head, msg);

  // 수정·삭제 칸 (비밀번호를 적어야 한다)
  let panel = null;
  function closePanel() {
    if (panel) panel.remove();
    panel = null;
  }

  function openPanel(mode) {
    closePanel();
    panel = el("div", "gb-edit");
    const status = el("p", "gb-edit-status");
    const password = el("input", "gb-edit-password");
    password.type = "password";
    password.placeholder = "글 비밀번호";
    password.maxLength = 30;
    password.autocomplete = "off";

    let message = null;
    if (mode === "edit") {
      message = el("input", "gb-edit-message");
      message.type = "text";
      message.maxLength = 200;
      message.value = row.message;
      panel.append(message);
    }

    const ok = gbButton(mode === "edit" ? "저장" : "삭제하기", "primary", async () => {
      const pw = password.value;
      if (pw.length < 4) {
        status.textContent = "글을 남길 때 적은 비밀번호를 적어 주세요.";
        return;
      }
      if (mode === "edit" && !message.value.trim()) {
        status.textContent = "한마디를 적어 주세요.";
        return;
      }
      if (mode === "remove" && !confirm("이 글을 지울까요? 되돌릴 수 없어요.")) return;

      ok.disabled = true;
      status.textContent = "";
      try {
        if (mode === "edit") {
          const updated = await rpc("resume_guestbook_edit", {
            p_id: row.id, p_password: pw, p_message: message.value.trim(),
          });
          row.message = updated.message;
          row.updated_at = updated.updated_at;
          msg.textContent = row.message;
          edited.textContent = "(수정됨)";
          closePanel();
          $("gb-status").textContent = "글을 고쳤어요.";
        } else {
          await rpc("resume_guestbook_remove", { p_id: row.id, p_password: pw });
          li.remove();
          $("gb-status").textContent = "글을 지웠어요.";
        }
      } catch (e) {
        status.textContent = e.reason || "잠시 뒤 다시 해 주세요.";
        ok.disabled = false;
      }
    });

    password.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) ok.click();
    });

    panel.append(password, ok, gbButton("취소", "", closePanel), status);
    li.append(panel);
    (message || password).focus();
  }

  tools.append(
    gbButton("수정", "", () => openPanel("edit")),
    gbButton("삭제", "danger", () => openPanel("remove"))
  );
  return li;
}

async function loadGuestbook() {
  const list = $("gb-list");
  try {
    const res = await api("resume_guestbook?select=" + GB_COLUMNS + "&order=created_at.desc&limit=100");
    const rows = await res.json();
    list.replaceChildren(...rows.map(makeGuestbookItem));
    if (rows.length === 0) $("gb-status").textContent = "첫 글을 남겨 주세요!";
  } catch (e) {
    $("gb-status").textContent = "방명록을 불러오지 못했어요.";
  }
}

async function submitGuestbook() {
  const nickInput = $("gb-nickname");
  const pwInput = $("gb-password");
  const msgInput = $("gb-message");
  const button = $("gb-submit");
  const status = $("gb-status");
  const nickname = nickInput.value.trim();
  const password = pwInput.value;
  const message = msgInput.value.trim();

  if (!nickname || !message) {
    status.textContent = "별명과 한마디를 모두 적어 주세요.";
    return;
  }
  if (password.length < 4) {
    status.textContent = "비밀번호를 4자 이상 적어 주세요. 내 글을 고치거나 지울 때 필요해요.";
    return;
  }

  button.disabled = true;
  status.textContent = "남기는 중…";
  try {
    const row = await rpc("resume_guestbook_add", {
      p_nickname: nickname, p_message: message, p_password: password,
    });
    $("gb-list").prepend(makeGuestbookItem(row));
    msgInput.value = "";
    pwInput.value = "";
    status.textContent = "고마워요! 글이 남겨졌어요.";
  } catch (e) {
    status.textContent = e.reason || "글을 남기지 못했어요. 잠시 뒤 다시 해 주세요.";
  } finally {
    button.disabled = false;
  }
}

$("gb-submit").addEventListener("click", submitGuestbook);
$("gb-message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) submitGuestbook();
});

// ===== 시작 =====
loadProfile();
loadProjects();
loadGuestbook();
