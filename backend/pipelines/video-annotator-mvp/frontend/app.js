const API_BASE = "http://localhost:8100";

const videoInput = document.getElementById("videoInput");
const textPrompt = document.getElementById("textPrompt");
const uploadBtn = document.getElementById("uploadBtn");
const processBtn = document.getElementById("processBtn");

const jobIdEl = document.getElementById("jobId");
const jobStatusEl = document.getElementById("jobStatus");
const jobStageEl = document.getElementById("jobStage");
const jobProgressEl = document.getElementById("jobProgress");
const jobMessageEl = document.getElementById("jobMessage");

const originalVideo = document.getElementById("originalVideo");
const annotatedVideo = document.getElementById("annotatedVideo");
const skipOutputVideo = document.getElementById("skipOutputVideo");

let currentJobId = null;
let pollTimer = null;

function setStatus(job) {
  jobIdEl.textContent = job.job_id || "-";
  jobStatusEl.textContent = job.status || "-";
  jobStageEl.textContent = job.stage || "-";
  jobProgressEl.textContent = `${job.progress ?? 0}%`;
  jobMessageEl.textContent = job.message || "";
  if (job.original_url) originalVideo.src = `${API_BASE}${job.original_url}`;
  if (job.annotated_url) {
    annotatedVideo.src = `${API_BASE}${job.annotated_url}`;
  } else {
    annotatedVideo.removeAttribute("src");
  }
}

async function uploadVideo() {
  if (!videoInput.files.length) return;
  const formData = new FormData();
  formData.append("file", videoInput.files[0]);

  uploadBtn.disabled = true;
  processBtn.disabled = true;
  jobMessageEl.textContent = "Uploading...";

  const res = await fetch(`${API_BASE}/api/videos`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Upload failed");
  }
  const data = await res.json();
  currentJobId = data.job_id;
  setStatus({
    ...data,
    stage: "upload",
    progress: 0,
    message: "Uploaded. Click Process.",
  });
  processBtn.disabled = false;
}

async function startProcess() {
  if (!currentJobId) return;
  processBtn.disabled = true;
  const payload = {
    text_prompt: textPrompt.value.trim() || null,
    allow_fallback: true,
    skip_output_video: skipOutputVideo.checked,
  };

  const res = await fetch(`${API_BASE}/api/jobs/${currentJobId}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to start processing");
  }
  const data = await res.json();
  setStatus(data);
  beginPolling();
}

function beginPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!currentJobId) return;
    const res = await fetch(`${API_BASE}/api/jobs/${currentJobId}`);
    if (!res.ok) return;
    const job = await res.json();
    setStatus(job);
    if (job.status === "completed" || job.status === "failed") {
      clearInterval(pollTimer);
      pollTimer = null;
      uploadBtn.disabled = false;
    }
  }, 1200);
}

uploadBtn.addEventListener("click", () => {
  uploadVideo().catch((err) => {
    uploadBtn.disabled = false;
    jobMessageEl.textContent = `Upload error: ${err.message}`;
  });
});

processBtn.addEventListener("click", () => {
  startProcess().catch((err) => {
    processBtn.disabled = false;
    jobMessageEl.textContent = `Process error: ${err.message}`;
  });
});

