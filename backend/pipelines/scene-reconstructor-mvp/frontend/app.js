const params = new URLSearchParams(window.location.search);
const API_BASE = params.get("api") || "http://localhost:8101";
const VISER_URL = params.get("viser") || "http://localhost:8081";

const videoInput = document.getElementById("videoInput");
const uploadBtn = document.getElementById("uploadBtn");
const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const fpsInput = document.getElementById("fpsInput");
const confInput = document.getElementById("confInput");

const jobIdEl = document.getElementById("jobId");
const jobStatusEl = document.getElementById("jobStatus");
const jobStageEl = document.getElementById("jobStage");
const jobMessageEl = document.getElementById("jobMessage");
const progressContainer = document.getElementById("progressContainer");
const progressFill = document.getElementById("progressFill");

const viewerSection = document.getElementById("viewerSection");
const viewerIframe = document.getElementById("viewerIframe");
const metadataEl = document.getElementById("metadata");
const metaFrames = document.getElementById("metaFrames");
const metaPoints = document.getElementById("metaPoints");
const metaSize = document.getElementById("metaSize");

let currentJobId = null;
let pollTimer = null;

function resetUiForNewJob() {
  viewerSection.style.display = "none";
  viewerIframe.src = "about:blank";
  metadataEl.style.display = "none";
  progressContainer.style.display = "none";
  progressFill.style.width = "0%";
  downloadBtn.style.display = "none";
  jobStageEl.textContent = "-";
  jobStatusEl.textContent = "idle";
}

function setStatus(job) {
  jobIdEl.textContent = job.job_id || "-";
  jobStatusEl.textContent = job.status || "-";
  jobStageEl.textContent = job.stage || "-";
  jobMessageEl.textContent = job.message || "";

  const progress = job.progress ?? 0;
  progressFill.style.width = `${progress}%`;

  if (job.status === "processing") {
    progressContainer.style.display = "block";
  }

  if (job.viewer_ready || job.status === "completed") {
    viewerSection.style.display = "flex";
    if (!viewerIframe.src || viewerIframe.src === "about:blank") {
      viewerIframe.src = VISER_URL;
    }
    downloadBtn.style.display = "inline-block";
    progressContainer.style.display = "none";

    if (job.metadata) {
      metadataEl.style.display = "block";
      metaFrames.textContent = job.metadata.num_frames ?? "-";
      metaPoints.textContent = (job.metadata.num_points ?? 0).toLocaleString();
      metaSize.textContent = (job.metadata.glb_size_mb ?? 0) + " MB";
    }
  }

  if (job.status === "failed") {
    progressContainer.style.display = "none";
    jobMessageEl.textContent = `Failed: ${job.error || job.message}`;
  }
}

async function uploadVideo() {
  if (!videoInput.files.length) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  resetUiForNewJob();

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
    message: "Uploaded. Click Reconstruct.",
  });
  processBtn.disabled = false;
}

async function startProcess() {
  if (!currentJobId) return;
  processBtn.disabled = true;

  const fpsValue = Number.parseInt(fpsInput.value, 10);
  const confValue = Number.parseFloat(confInput.value);
  const payload = {
    fps: Number.isFinite(fpsValue) ? fpsValue : 2,
    conf_percentile: Number.isFinite(confValue) ? confValue : 25,
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
  }, 1500);
}

function downloadGlb() {
  if (!currentJobId) return;
  window.open(`${API_BASE}/api/jobs/${currentJobId}/download`, "_blank");
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

downloadBtn.addEventListener("click", downloadGlb);
