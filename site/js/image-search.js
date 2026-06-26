(function () {
  "use strict";

  const MAX_BYTES = 5 * 1024 * 1024;
  const SEARCH_CLASSES = ["named", "unknown", "unidentified", "ignored"];
  const MAX_RESULT_CANDIDATES = 3;
  const CROP_PADDING = 0.2;

  const dropzoneEl = document.getElementById("image-search-dropzone");
  const fileInputEl = document.getElementById("image-search-file-input");
  const previewEl = document.getElementById("image-search-preview");
  const workspaceEl = document.getElementById("image-search-workspace");
  const workspacePanelEl = document.getElementById("image-search-workspace-panel");
  const selectedFaceEl = document.getElementById("image-search-selected-face");
  const clearBtnEl = document.getElementById("image-search-clear");
  const submitBtnEl = document.getElementById("image-search-submit");
  const statusEl = document.getElementById("image-search-status");
  const resultsEl = document.getElementById("image-search-results");
  const decisionLabelEl = document.getElementById("image-search-decision-label");
  const decisionDetailEl = document.getElementById("image-search-decision-detail");
  const candidatesEl = document.getElementById("image-search-candidates");
  const pickerEl = document.getElementById("image-search-face-picker");
  const pickerGridEl = document.getElementById("image-search-face-picker-grid");
  const pickerCancelEl = document.getElementById("image-search-face-picker-cancel");
  const processingEl = document.getElementById("image-search-processing");
  const processingThumbEl = document.getElementById("image-search-processing-thumb");

  if (!dropzoneEl) throw new Error("Missing #image-search-dropzone");
  if (!fileInputEl) throw new Error("Missing #image-search-file-input");
  if (!previewEl) throw new Error("Missing #image-search-preview");
  if (!workspaceEl) throw new Error("Missing #image-search-workspace");
  if (!workspacePanelEl) throw new Error("Missing #image-search-workspace-panel");
  if (!selectedFaceEl) throw new Error("Missing #image-search-selected-face");
  if (!clearBtnEl) throw new Error("Missing #image-search-clear");
  if (!submitBtnEl) throw new Error("Missing #image-search-submit");
  if (!statusEl) throw new Error("Missing #image-search-status");
  if (!resultsEl) throw new Error("Missing #image-search-results");
  if (!decisionLabelEl) throw new Error("Missing #image-search-decision-label");
  if (!decisionDetailEl) throw new Error("Missing #image-search-decision-detail");
  if (!candidatesEl) throw new Error("Missing #image-search-candidates");
  if (!pickerEl) throw new Error("Missing #image-search-face-picker");
  if (!pickerGridEl) throw new Error("Missing #image-search-face-picker-grid");
  if (!pickerCancelEl) throw new Error("Missing #image-search-face-picker-cancel");
  if (!processingEl) throw new Error("Missing #image-search-processing");
  if (!processingThumbEl) throw new Error("Missing #image-search-processing-thumb");
  if (!window.SiteShared) throw new Error("SiteShared not loaded (include shared.js first)");

  let selectedFile = null;
  let searchCropFile = null;
  let previewObjectUrl = null;
  let selectedFaceObjectUrl = null;
  let processAbort = null;
  let searchAbort = null;
  let pickerResolve = null;
  let pickerReject = null;

  function setStatus(message, isError) {
    const text = String(message || "").trim();
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.classList.remove("search-status-error");
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.toggle("search-status-error", Boolean(isError));
  }

  function hideResults() {
    resultsEl.hidden = true;
    resultsEl.classList.remove("image-search-results--match");
    resultsEl.classList.remove.apply(resultsEl.classList, CONFIDENCE_RESULT_CLASSES);
    candidatesEl.replaceChildren();
    decisionLabelEl.textContent = "";
    decisionDetailEl.textContent = "";
  }

  function revokePreviewUrl() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  function revokeSelectedFaceUrl() {
    if (selectedFaceObjectUrl) {
      URL.revokeObjectURL(selectedFaceObjectUrl);
      selectedFaceObjectUrl = null;
    }
  }

  function showProcessing() {
    processingEl.hidden = false;
    document.body.classList.add("image-search-processing-open");
  }

  function hideProcessing() {
    processingEl.hidden = true;
    document.body.classList.remove("image-search-processing-open");
  }

  function closeFacePicker() {
    pickerEl.hidden = true;
    document.body.classList.remove("image-search-picker-open");
    pickerGridEl.replaceChildren();
    pickerResolve = null;
    pickerReject = null;
  }

  function hideSelectedFace() {
    revokeSelectedFaceUrl();
    selectedFaceEl.removeAttribute("src");
    workspacePanelEl.hidden = true;
    workspaceEl.classList.remove("image-search-workspace--ready");
  }

  function clearSelection() {
    if (processAbort) {
      processAbort.abort();
      processAbort = null;
    }
    if (searchAbort) {
      searchAbort.abort();
      searchAbort = null;
    }
    closeFacePicker();
    hideProcessing();
    hideSelectedFace();
    selectedFile = null;
    searchCropFile = null;
    fileInputEl.value = "";
    revokePreviewUrl();
    previewEl.removeAttribute("src");
    submitBtnEl.disabled = true;
    hideResults();
    setStatus("");
  }

  function isImageFile(file) {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("image/")) return true;
    const name = String(file.name || "").toLowerCase();
    return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/.test(name);
  }

  function validateFile(file) {
    if (!isImageFile(file)) {
      throw new Error("Please choose an image file (JPEG, PNG, or WebP).");
    }
    if (file.size > MAX_BYTES) {
      throw new Error("Image is too large (max 5 MB).");
    }
  }

  function fileFromDataTransfer(dt) {
    if (!dt) return null;
    if (dt.files && dt.files.length) {
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i];
        if (isImageFile(f)) return f;
      }
    }
    if (dt.items) {
      for (let j = 0; j < dt.items.length; j++) {
        const item = dt.items[j];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          return item.getAsFile();
        }
      }
    }
    return null;
  }

  function fileFromClipboard(clipboardData) {
    if (!clipboardData || !clipboardData.items) return null;
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        return item.getAsFile();
      }
    }
    return null;
  }

  function formatPct(similarity) {
    const x = Number(similarity);
    if (!Number.isFinite(x)) return "—";
    return (x * 100).toFixed(1) + "%";
  }

  function decisionHeading(decision) {
    if (decision === "match") return "Likely match";
    if (decision === "ambiguous") return "Unclear match";
    if (decision === "no_match") return "No confident match";
    return "Results";
  }

  const CONFIDENCE_RESULT_CLASSES = [
    "image-search-results--confidence-high",
    "image-search-results--confidence-medium",
    "image-search-results--confidence-low",
  ];

  function confidenceClassForDecision(decision) {
    if (decision === "match") return "image-search-results--confidence-high";
    if (decision === "ambiguous") return "image-search-results--confidence-medium";
    if (decision === "no_match") return "image-search-results--confidence-low";
    return "";
  }

  function setResultsConfidence(decision) {
    resultsEl.classList.remove.apply(resultsEl.classList, CONFIDENCE_RESULT_CLASSES);
    const cls = confidenceClassForDecision(decision);
    if (cls) resultsEl.classList.add(cls);
  }

  function renderCandidates(candidates, options) {
    const opts = options || {};
    candidatesEl.replaceChildren();
    const list = Array.isArray(candidates) ? candidates : [];
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "image-search-candidates-empty";
      li.textContent = "No candidates returned.";
      candidatesEl.appendChild(li);
      return;
    }

    list.forEach(function (row, index) {
      const li = document.createElement("li");
      li.className = "image-search-candidate";

      const personUrl = SiteShared.peopleUrlForPersonIds([row.person_id]);
      const cardLink = document.createElement(personUrl ? "a" : "div");
      cardLink.className = "image-search-candidate-link";
      if (personUrl) {
        cardLink.href = personUrl;
      }
      if (opts.hideRank) {
        cardLink.classList.add("image-search-candidate-link--solo");
      }
      if (opts.featured) {
        cardLink.classList.add("image-search-candidate-link--featured");
      }

      if (!opts.hideRank) {
        const rank = document.createElement("span");
        rank.className = "image-search-candidate-rank";
        rank.textContent = String(index + 1);
        rank.setAttribute("aria-hidden", "true");
        cardLink.appendChild(rank);
      }

      const thumbWrap = document.createElement("span");
      thumbWrap.className = "image-search-candidate-thumb";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      const faceUrl = row.image ? SiteShared.cdnAssetUrl(row.image) : null;
      if (faceUrl) {
        img.src = faceUrl;
      } else {
        img.classList.add("image-search-candidate-thumb--missing");
      }
      thumbWrap.appendChild(img);

      const body = document.createElement("div");
      body.className = "image-search-candidate-body";

      const nameEl = document.createElement("p");
      nameEl.className = "image-search-candidate-name";
      const display = SiteShared.personDisplayName(row.person_id, row.name, function (n) {
        return "Person " + n;
      });
      nameEl.textContent = display;

      const metaEl = document.createElement("p");
      metaEl.className = "image-search-candidate-meta";
      metaEl.textContent = formatPct(row.similarity) + " similarity";

      body.appendChild(nameEl);
      body.appendChild(metaEl);

      cardLink.appendChild(thumbWrap);
      cardLink.appendChild(body);
      li.appendChild(cardLink);
      candidatesEl.appendChild(li);
    });
  }

  function renderResults(data) {
    const decision = data.decision;
    decisionLabelEl.textContent = decisionHeading(decision);
    setResultsConfidence(decision);

    decisionDetailEl.textContent = "";
    decisionDetailEl.hidden = true;

    if (decision === "match") {
      resultsEl.classList.add("image-search-results--match");
      const best = data.best_match || (Array.isArray(data.candidates) ? data.candidates[0] : null);
      renderCandidates(best ? [best] : [], { hideRank: true, featured: true });
    } else {
      resultsEl.classList.remove("image-search-results--match");
      const list = Array.isArray(data.candidates) ? data.candidates.slice(0, MAX_RESULT_CANDIDATES) : [];
      renderCandidates(list);
    }
    resultsEl.hidden = false;
  }

  function waitForImageLoad(img) {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      function onLoad() {
        cleanup();
        resolve();
      }
      function onError() {
        cleanup();
        reject(new Error("Could not load uploaded image."));
      }
      function cleanup() {
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      }
      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);
    });
  }

  function cropFaceToCanvas(img, bbox) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const x1 = Number(bbox.x1);
    const y1 = Number(bbox.y1);
    const x2 = Number(bbox.x2);
    const y2 = Number(bbox.y2);
    const bw = x2 - x1;
    const bh = y2 - y1;
    const padX = bw * CROP_PADDING;
    const padY = bh * CROP_PADDING;
    const left = Math.max(0, Math.floor(x1 - padX));
    const top = Math.max(0, Math.floor(y1 - padY));
    const right = Math.min(w, Math.ceil(x2 + padX));
    const bottom = Math.min(h, Math.ceil(y2 + padY));
    const cw = right - left;
    const ch = bottom - top;
    if (cw <= 0 || ch <= 0) {
      throw new Error("Invalid face bounding box.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas for face crop.");
    ctx.drawImage(img, left, top, cw, ch, 0, 0, cw, ch);
    return canvas;
  }

  function canvasToJpegFile(canvas, filename) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("Could not encode face crop."));
            return;
          }
          resolve(new File([blob], filename, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.92
      );
    });
  }

  async function cropFaceFile(face) {
    await waitForImageLoad(previewEl);
    const canvas = cropFaceToCanvas(previewEl, face.bbox);
    const base = selectedFile && selectedFile.name ? selectedFile.name.replace(/\.[^.]+$/, "") : "face";
    return canvasToJpegFile(canvas, base + "-face-" + String(face.index) + ".jpg");
  }

  function faceOptionThumbDataUrl(face) {
    const canvas = cropFaceToCanvas(previewEl, face.bbox);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  function showSelectedCrop(cropFile) {
    searchCropFile = cropFile;
    revokeSelectedFaceUrl();
    selectedFaceObjectUrl = URL.createObjectURL(cropFile);
    selectedFaceEl.src = selectedFaceObjectUrl;
    workspacePanelEl.hidden = false;
    workspaceEl.classList.add("image-search-workspace--ready");
    submitBtnEl.disabled = false;
  }

  function openFacePicker(faces) {
    return new Promise(function (resolve, reject) {
      pickerResolve = resolve;
      pickerReject = reject;
      pickerGridEl.replaceChildren();
      const cols = faces.length <= 4 ? faces.length : 4;
      pickerGridEl.style.setProperty("--face-picker-cols", String(cols));

      faces.forEach(function (face, i) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "image-search-face-option";
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-label", "Face " + String(i + 1));

        const thumb = document.createElement("img");
        thumb.className = "image-search-face-option-thumb";
        thumb.alt = "";
        thumb.src = faceOptionThumbDataUrl(face);

        btn.appendChild(thumb);
        btn.addEventListener("click", function () {
          closeFacePicker();
          resolve(face);
        });
        pickerGridEl.appendChild(btn);
      });

      pickerEl.hidden = false;
      document.body.classList.add("image-search-picker-open");
      const first = pickerGridEl.querySelector(".image-search-face-option");
      if (first) first.focus();
    });
  }

  async function detectFaces(signal) {
    const form = new FormData();
    form.append("image", selectedFile, selectedFile.name || "upload.jpg");
    const res = await fetch(SiteShared.API_BASE + "/search/face/detect", {
      method: "POST",
      body: form,
      signal: signal,
    });
    let payload;
    try {
      payload = await res.json();
    } catch (parseErr) {
      throw new Error("Invalid response from face detector.");
    }
    if (!res.ok) {
      const msg =
        (payload && (payload.message || payload.error)) ||
        "Face detection failed (" + res.status + ").";
      throw new Error(String(msg));
    }
    const faces = Array.isArray(payload.faces) ? payload.faces : [];
    if (!faces.length) {
      throw new Error("No face detected in uploaded image.");
    }
    return faces;
  }

  async function searchWithFile(imageFile, signal) {
    const params = new URLSearchParams();
    params.set("classes", SEARCH_CLASSES.join(","));
    const form = new FormData();
    form.append("image", imageFile, imageFile.name || "face.jpg");

    const res = await fetch(SiteShared.API_BASE + "/search/face?" + params.toString(), {
      method: "POST",
      body: form,
      signal: signal,
    });

    let payload;
    try {
      payload = await res.json();
    } catch (parseErr) {
      throw new Error("Invalid response from server.");
    }
    if (!res.ok) {
      const msg =
        (payload && (payload.message || payload.error)) ||
        "Search failed (" + res.status + ").";
      throw new Error(String(msg));
    }
    return payload;
  }

  async function applySelectedFace(face) {
    const cropFile = await cropFaceFile(face);
    showSelectedCrop(cropFile);
  }

  async function processUpload(file) {
    validateFile(file);

    if (processAbort) processAbort.abort();
    if (searchAbort) searchAbort.abort();
    processAbort = new AbortController();
    const signal = processAbort.signal;

    closeFacePicker();
    hideSelectedFace();
    hideResults();
    searchCropFile = null;
    submitBtnEl.disabled = true;
    setStatus("");

    selectedFile = file;
    revokePreviewUrl();
    previewObjectUrl = URL.createObjectURL(file);
    previewEl.src = previewObjectUrl;
    processingThumbEl.src = previewObjectUrl;

    showProcessing();

    try {
      await waitForImageLoad(previewEl);
      const faces = await detectFaces(signal);
      hideProcessing();

      if (faces.length === 1) {
        await applySelectedFace(faces[0]);
      } else {
        const chosen = await openFacePicker(faces);
        await applySelectedFace(chosen);
      }
      processAbort = null;
    } catch (err) {
      hideProcessing();
      if (err && err.name === "AbortError") {
        clearSelection();
        return;
      }
      clearSelection();
      setStatus(err && err.message ? err.message : "Could not process image.", true);
      processAbort = null;
    }
  }

  async function runSearch() {
    if (!searchCropFile) {
      setStatus("Upload a photo and wait for face detection to finish.", true);
      return;
    }

    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const signal = searchAbort.signal;

    submitBtnEl.disabled = true;
    hideResults();
    setStatus("Searching…");

    try {
      const payload = await searchWithFile(searchCropFile, signal);
      setStatus("");
      renderResults(payload);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      setStatus(err && err.message ? err.message : "Search failed.", true);
    }

    submitBtnEl.disabled = false;
    searchAbort = null;
  }

  function beginUpload(file) {
    processUpload(file).catch(function (err) {
      if (err && err.name === "AbortError") return;
      setStatus(err && err.message ? err.message : "Could not process image.", true);
    });
  }

  dropzoneEl.addEventListener("click", function (e) {
    if (e.target.closest("label.image-search-browse-label")) return;
    fileInputEl.click();
  });

  dropzoneEl.addEventListener("dragenter", function (e) {
    e.preventDefault();
    dropzoneEl.classList.add("image-search-dropzone--active");
  });
  dropzoneEl.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropzoneEl.classList.add("image-search-dropzone--active");
  });
  dropzoneEl.addEventListener("dragleave", function () {
    dropzoneEl.classList.remove("image-search-dropzone--active");
  });
  dropzoneEl.addEventListener("drop", function (e) {
    e.preventDefault();
    dropzoneEl.classList.remove("image-search-dropzone--active");
    const file = fileFromDataTransfer(e.dataTransfer);
    if (!file) {
      setStatus("Drop an image file.", true);
      return;
    }
    beginUpload(file);
  });

  dropzoneEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      if (e.target !== dropzoneEl) return;
      e.preventDefault();
      fileInputEl.click();
    }
  });

  fileInputEl.addEventListener("change", function () {
    const file = fileInputEl.files && fileInputEl.files[0];
    if (!file) return;
    fileInputEl.value = "";
    beginUpload(file);
  });

  document.addEventListener("paste", function (e) {
    const file = fileFromClipboard(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    beginUpload(file);
  });

  pickerCancelEl.addEventListener("click", function () {
    const reject = pickerReject;
    if (reject) {
      reject(new DOMException("Face selection cancelled.", "AbortError"));
      return;
    }
    clearSelection();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!pickerEl.hidden) {
        pickerCancelEl.click();
        return;
      }
      if (!processingEl.hidden) {
        clearSelection();
      }
    }
  });

  clearBtnEl.addEventListener("click", clearSelection);
  submitBtnEl.addEventListener("click", runSearch);

  window.addEventListener("pagehide", function () {
    revokePreviewUrl();
    revokeSelectedFaceUrl();
  });
})();
