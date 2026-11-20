const API_BASE = "http://127.0.0.1:8000";
const $ = id => document.getElementById(id);
const fileInput = $("fileInput"), cameraInput = $("cameraInput");
const dropZone = $("dropZone"), previewContainer = $("previewContainer");
const imagePreview = $("imagePreview"), analyseBtn = $("analyseBtn");
let selectedFile = null, previewURL = null, historyItems = [];

try { historyItems = JSON.parse(localStorage.getItem("upiShieldHistory") || "[]"); if (!Array.isArray(historyItems)) historyItems = []; } catch { historyItems = []; }

$("browseBtn").addEventListener("click", () => fileInput.click());
$("cameraBtn").addEventListener("click", () => cameraInput.click());
fileInput.addEventListener("change", e => handleFile(e.target.files[0]));
cameraInput.addEventListener("change", e => handleFile(e.target.files[0]));
$("removeBtn").addEventListener("click", clearSelectedImage);

function handleFile(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return alert("Choose a JPG, PNG or WEBP image.");
  if (file.size > 10 * 1024 * 1024) return alert("Image must be smaller than 10 MB.");
  selectedFile = file;
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = URL.createObjectURL(file);
  imagePreview.src = previewURL;
  $("fileName").textContent = file.name;
  $("fileSize").textContent = (file.size / 1024).toFixed(1) + " KB";
  previewContainer.style.display = "block";
  analyseBtn.disabled = false;
  $("resultStatus").textContent = "READY TO ANALYSE";
  $("resultContent").className = "empty-result";
  $("resultContent").innerHTML = "<div class='empty-icon'>⌕</div><h3>Image selected</h3><p>Press Analyse Screenshot to run OCR and forensic heuristics.</p>";
  addHistory(file.name, "Queued");
}
function clearSelectedImage() {
  selectedFile = null;
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null; imagePreview.src = "";
  previewContainer.style.display = "none"; analyseBtn.disabled = true;
  fileInput.value = ""; cameraInput.value = "";
}
["dragenter","dragover","dragleave","drop"].forEach(name => dropZone.addEventListener(name, e => {e.preventDefault();e.stopPropagation();}));
["dragenter","dragover"].forEach(name => dropZone.addEventListener(name, () => dropZone.classList.add("drag-over")));
["dragleave","drop"].forEach(name => dropZone.addEventListener(name, () => dropZone.classList.remove("drag-over")));
dropZone.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));

function addHistory(name, status) {
  const item = {name, status, date: new Date().toLocaleString()};
  historyItems.unshift(item); historyItems = historyItems.slice(0, 25);
  saveHistory(); renderHistory();
}
function updateHistory(name, status) {
  const item = historyItems.find(x => x.name === name);
  if (item) item.status = status;
  saveHistory(); renderHistory();
}
function saveHistory() { localStorage.setItem("upiShieldHistory", JSON.stringify(historyItems)); }
function renderHistory() {
  const list = $("historyList"); list.innerHTML = "";
  if (!historyItems.length) {
    list.innerHTML = "<div class='history-empty'><div>◷</div><h3>No recent activity</h3><p>Your analyses will appear here.</p></div>";
  } else historyItems.forEach(item => {
    const row = document.createElement("div"); row.className = "history-row";
    [item.name, item.date, item.status].forEach(value => { const span = document.createElement("span"); span.textContent = value; row.appendChild(span); });
    list.appendChild(row);
  });
  $("totalChecks").textContent = historyItems.length;
  $("flaggedChecks").textContent = historyItems.filter(x => x.status === "Suspicious").length;
}
$("clearHistoryBtn").addEventListener("click", () => {
  if (confirm("Clear all local activity history?")) { historyItems = []; localStorage.removeItem("upiShieldHistory"); renderHistory(); }
});

async function checkBackend() {
  try {
    const r = await fetch(`${API_BASE}/health`, {signal: AbortSignal.timeout(2500)});
    if (!r.ok) throw new Error("offline");
    $("systemStatus").textContent = "Backend connected";
    $("backendMetric").textContent = "ON";
    $("backendCaption").textContent = "API reachable";
  } catch {
    $("systemStatus").textContent = "Backend offline";
    $("backendMetric").textContent = "OFF";
    $("backendCaption").textContent = "Start Python server";
  }
}
analyseBtn.addEventListener("click", async () => {
  if (!selectedFile) return alert("Select an image first.");
  const originalName = selectedFile.name;
  const form = new FormData(); form.append("file", selectedFile);
  analyseBtn.disabled = true; analyseBtn.textContent = "Analysing…";
  $("resultStatus").textContent = "PROCESSING";
  $("resultContent").className = "empty-result";
  $("resultContent").innerHTML = "<div class='empty-icon'>⟳</div><h3>Inspecting screenshot…</h3><p>Extracting text and checking available forensic signals.</p>";
  try {
    const response = await fetch(`${API_BASE}/analyse`, {method:"POST", body:form});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || "Analysis failed");
    renderResult(data);
    updateHistory(originalName, data.verdict === "SUSPICIOUS" ? "Suspicious" : "Reviewed");
  } catch (err) {
    $("resultStatus").textContent = "ERROR";
    $("resultContent").innerHTML = `<h3>Could not analyse image</h3><p>${escapeHtml(err.message)}. Make sure the backend is running.</p>`;
    updateHistory(originalName, "Error");
  } finally {
    analyseBtn.disabled = !selectedFile; analyseBtn.textContent = "Analyse Screenshot →"; checkBackend();
  }
});
function renderResult(data) {
  const suspicious = data.verdict === "SUSPICIOUS";
  const verdictClass = suspicious ? "suspicious" : data.verdict === "NEEDS_REVIEW" ? "review" : "limited";
  const checks = (data.checks || []).map(c => `<li><strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(c.detail)}</li>`).join("");
  const reasons = (data.reasons || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
  const fields = data.extracted || {};
  $("resultStatus").textContent = data.verdict.replaceAll("_"," ");
  $("resultContent").className = "result-summary";
  $("resultContent").innerHTML = `
    <div class="verdict ${verdictClass}">${escapeHtml(data.verdict.replaceAll("_"," "))}</div>
    <p>${escapeHtml(data.summary || "")}</p>
    <div class="result-grid">
      <div class="result-metric"><small>Detected app</small><strong>${escapeHtml(fields.app || "Unknown")}</strong></div>
      <div class="result-metric"><small>Amount</small><strong>${escapeHtml(fields.amount || "Not found")}</strong></div>
      <div class="result-metric"><small>Transaction reference</small><strong>${escapeHtml(fields.transaction_id || "Not found")}</strong></div>
      <div class="result-metric"><small>Timestamp</small><strong>${escapeHtml(fields.timestamp || "Not found")}</strong></div>
    </div>
    <h4 style="margin-top:20px">Checks performed</h4><ul class="check-list">${checks || "<li>No checks returned.</li>"}</ul>
    <h4 style="margin-top:20px">Warnings / findings</h4><ul class="check-list">${reasons || "<li>No obvious warning was detected by the prototype checks.</li>"}</ul>
    <p style="margin-top:16px;font-size:11px;color:#f0cc7d">${escapeHtml(data.disclaimer || "")}</p>
    <details style="margin-top:16px"><summary style="cursor:pointer;color:#80b9ff">View OCR text</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px;color:#b8c5d8;font-size:11px">${escapeHtml(data.ocr_text || "No text extracted")}</pre></details>`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
document.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach(n => n.classList.remove("active")); link.classList.add("active");
}));
renderHistory(); checkBackend();
