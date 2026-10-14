const thread = document.getElementById("thread");
const orb = document.getElementById("orb");
const orbLabel = document.getElementById("orbLabel");
const inp = document.getElementById("inp");
const sendBtn = document.getElementById("send");
const history = [];

function el(cls, text) {
  const d = document.createElement("div");
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}
function addTend(text) {
  const m = el("msg tend");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = "TEND";
  m.appendChild(who);
  m.appendChild(document.createTextNode(text));
  thread.appendChild(m);
  scrollDown();
}
function addTrace(name, args, result) {
  const t = el("trace");
  const det = document.createElement("details");
  const sum = document.createElement("summary");
  sum.textContent = `MCP tool call  -  ${name}`;
  const body = el("body");
  body.className = "body";
  body.innerHTML = `<span class="arrow">→</span> ${name}(${escapeHtml(JSON.stringify(args))})\n<span class="arrow">←</span> ${escapeHtml(result || "")}`;
  det.appendChild(sum); det.appendChild(body);
  t.appendChild(det);
  thread.appendChild(t);
  scrollDown();
}
function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function scrollDown() { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }
function setOrb(state, label) {
  orb.className = "orb " + state;
  orbLabel.textContent = label;
}

async function send(text) {
  if (!text.trim()) return;
  const m = el("msg them", text);
  thread.appendChild(m);
  inp.value = "";
  sendBtn.disabled = true;
  setOrb("speaking", "Tend is thinking…");
  scrollDown();

  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: text, history }),
  });
  history.push({ role: "user", content: text });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let pendingName = null, pendingArgs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.kind === "tool_call") { pendingName = ev.name; pendingArgs = ev.args; setOrb("speaking", `Tend is checking ${ev.name.replaceAll("_", " ")}…`); }
      if (ev.kind === "tool_result") { addTrace(pendingName ?? ev.name, pendingArgs ?? {}, ev.result); pendingName = pendingArgs = null; }
      if (ev.kind === "reply" || ev.kind === "done") {
        if (ev.kind === "done") { addTend(ev.text); history.push({ role: "assistant", content: ev.text }); }
      }
      if (ev.kind === "error") addTend("Something went wrong: " + ev.text);
    }
  }
  sendBtn.disabled = false;
  setOrb("listening", "Tend is ready for your text");
  inp.focus();
}

sendBtn.onclick = () => send(inp.value);
inp.addEventListener("keydown", (e) => { if (e.key === "Enter") send(inp.value); });

// Opening beat
window.addEventListener("load", () => {
  setTimeout(() => {
    addTend("Good morning. I'm Tend  -  I'm here with Meera each day, and I keep her family close. Say good morning to begin today's check-in.");
  }, 600);
});
