document.addEventListener("DOMContentLoaded", () => {
    const registerForm = document.getElementById("registerForm");
    const loginForm = document.getElementById("loginForm");
    const reportForm = document.getElementById("reportForm");
    const thoughtForm = document.getElementById("thoughtForm");
    const deleteAccountForm = document.getElementById("deleteAccountForm");
    const registerStart = document.getElementById("registerStart");
    const loginStart = document.getElementById("loginStart");
    [
        ["registerPassword", "registerPasswordToggle"],
        ["registerConfirmPassword", "registerConfirmPasswordToggle"],
        ["loginPassword", "loginPasswordToggle"]
    ].forEach(([inputId, toggleId]) => {
        const passwordInput = document.getElementById(inputId);
        const passwordToggle = document.getElementById(toggleId);
        if (!passwordInput || !passwordToggle) {
            return;
        }

        const setPasswordVisibility = (isVisible) => {
            passwordInput.type = isVisible ? "text" : "password";
            passwordToggle.setAttribute("aria-pressed", String(isVisible));
            passwordToggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
            passwordToggle.querySelector(".password-icon-show").hidden = isVisible;
            passwordToggle.querySelector(".password-icon-hide").hidden = !isVisible;
        };

        passwordToggle.addEventListener("click", () => {
            setPasswordVisibility(passwordInput.type === "password");
        });
        passwordInput.form.addEventListener("reset", () => setPasswordVisibility(false));
    });

    if (registerStart && loginStart) {
        registerStart.addEventListener("click", () => showAccountPanel("register", true));
        loginStart.addEventListener("click", () => showAccountPanel("login", true));
    }

    document.querySelectorAll(".form-back").forEach((button) => {
        button.addEventListener("click", () => {
            document.getElementById("accountCard").hidden = true;
            document.querySelector(".account-entry-actions").hidden = false;
            document.getElementById("registerStart").focus();
        });
    });

    if (registerForm) {
        registerForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (registerForm.elements.password.value !== registerForm.elements.confirm_password.value) {
                setMessage(document.getElementById("registerMessage"), "Passwords do not match.", "error");
                return;
            }
            registerWithSupabase(registerForm);
        });
    }

    if (loginForm) {
        loginForm.addEventListener("submit", (event) => {
            event.preventDefault();
            loginWithSupabase(loginForm);
        });
    }

    if (deleteAccountForm) {
        deleteAccountForm.addEventListener("submit", (event) => {
            event.preventDefault();
            deleteAccountFromWeb(deleteAccountForm);
        });
    }

    if (thoughtForm) {
        thoughtForm.addEventListener("submit", (event) => {
            event.preventDefault();
            submitThoughtForm(thoughtForm);
        });
    }

    if (reportForm) {
        if (sessionStorage.getItem("communityReportingLoginSuccess") === "true") {
            sessionStorage.removeItem("communityReportingLoginSuccess");
            setMessage(document.getElementById("reportMessage"), "Signed in successfully.", "success");
        }
        reportForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (cameraRecording) {
                setMessage(document.getElementById("cameraMessage"), "Stop the active recording before submitting your report.", "error");
                return;
            }
            submitReportForm(reportForm);
            return;
        });
        initializeAttachments();
        initializeCamera();
    }

    if (document.getElementById("solutionsContainer")) {
        const reportNotice = document.getElementById("reportSubmissionNotice");
        const reportResult = new URLSearchParams(window.location.search).get("report");
        if (reportNotice && reportResult === "submitted") {
            setMessage(reportNotice, "Your report was saved and the administrator was notified.", "success");
        } else if (reportNotice && reportResult === "email-failed") {
            setMessage(
                reportNotice,
                "Your report was saved, but the administrator email could not be sent. Please contact the administrator; do not submit the report again.",
                "error"
            );
        }
        loadAccountStatus().then(async (isAdmin) => {
            try {
                const session = await getSupabaseSession();
                if (!session || !session.access_token) {
                    throw new Error("Sign-in required.");
                }
            } catch {
                window.location.replace("index.html");
                return;
            }
            loadSolutions();
            loadCommunityThoughts();
            if (isAdmin) {
                loadResidentDirectory();
            }
        });
    } else {
        loadAccountStatus().then(async () => {
            if (reportForm) {
                try {
                    const session = await getSupabaseSession();
                    if (!session || !session.access_token) {
                        throw new Error("Sign-in required.");
                    }
                } catch {
                    window.location.replace("index.html");
                }
            }
        });
    }
});

const reportAttachments = [];
const maximumAttachments = 5;
const maximumAttachmentSize = 25 * 1024 * 1024;
const maximumTotalAttachmentSize = 50 * 1024 * 1024;
const supabaseUrl = "https://lcvymcpgbpeuexeosocv.supabase.co";
const supabasePublishableKey = "sb_publishable_IWDBAEjDtQOz1Mdb4sFaog_iw2JKBhl";
const supabaseSessionKey = "communityReportingSupabaseSession";
let cameraRecording = false;
let currentUserIsAdmin = false;
const allowedAttachmentTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
    "application/pdf"
]);

async function supabaseRequest(path, options = {}) {
    const headers = {
        Accept: "application/json",
        apikey: supabasePublishableKey,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options.headers
    };
    const response = await fetch(`${supabaseUrl}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.rawBody !== undefined
            ? options.rawBody
            : options.body !== undefined
                ? JSON.stringify(options.body)
                : undefined
    });
    const responseText = await response.text();
    let result = null;
    if (responseText) {
        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(`Supabase returned an invalid response (HTTP ${response.status}).`);
        }
    }
    if (!response.ok) {
        throw new Error(
            result && (result.msg || result.message || result.error_description || result.error)
                ? (result.msg || result.message || result.error_description || result.error)
                : `Supabase request failed (HTTP ${response.status}).`
        );
    }
    if (!result && response.status !== 204 && response.status !== 201) {
        throw new Error(`Supabase returned an empty response (HTTP ${response.status}).`);
    }
    return result;
}

function storeSupabaseSession(session) {
    const normalizedSession = {
        ...session,
        expires_at: session.expires_at || (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : null)
    };
    localStorage.setItem(supabaseSessionKey, JSON.stringify(normalizedSession));
    return normalizedSession;
}

async function getSupabaseSession() {
    let storedSession = localStorage.getItem(supabaseSessionKey);
    if (!storedSession) {
        storedSession = sessionStorage.getItem(supabaseSessionKey);
        if (storedSession) {
            localStorage.setItem(supabaseSessionKey, storedSession);
            sessionStorage.removeItem(supabaseSessionKey);
        }
    }
    if (!storedSession) {
        return null;
    }

    let session;
    try {
        session = JSON.parse(storedSession);
    } catch {
        localStorage.removeItem(supabaseSessionKey);
        sessionStorage.removeItem(supabaseSessionKey);
        throw new Error("Your saved sign-in session is invalid. Please sign in again.");
    }

    if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
        if (!session.refresh_token) {
            localStorage.removeItem(supabaseSessionKey);
            sessionStorage.removeItem(supabaseSessionKey);
            return null;
        }
        try {
            session = storeSupabaseSession(await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
                method: "POST",
                body: { refresh_token: session.refresh_token }
            }));
        } catch (error) {
            localStorage.removeItem(supabaseSessionKey);
            sessionStorage.removeItem(supabaseSessionKey);
            throw error;
        }
    }
    return session;
}

async function verifySavedProfile(accessToken, expectedIdNumber) {
    const user = await supabaseRequest("/auth/v1/user", { token: accessToken });
    const profiles = await supabaseRequest(
        `/rest/v1/profiles?select=first_name,second_name,last_name,phone_number,id_no&id=eq.${encodeURIComponent(user.id)}`,
        { token: accessToken }
    );
    const profile = profiles[0];
    if (!profile || profile.id_no !== expectedIdNumber) {
        throw new Error("Your account details could not be verified. Please contact support.");
    }
    return profile;
}

async function registerWithSupabase(form) {
    const message = document.getElementById("registerMessage");
    const submitButton = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    const idNumber = String(values.get("id_no")).trim();
    if (!/^[0-9]+$/.test(idNumber)) {
        setMessage(message, "ID number must contain digits only.", "error");
        return;
    }
    submitButton.disabled = true;
    setMessage(message, "Creating your account...", "");

    try {
        const result = await supabaseRequest("/functions/v1/register-with-id", {
            method: "POST",
            body: {
                email: String(values.get("email")).trim(),
                password: String(values.get("password")),
                first_name: String(values.get("first_name")).trim(),
                second_name: String(values.get("second_name")).trim(),
                last_name: String(values.get("last_name")).trim(),
                phone_number: String(values.get("phone_number")).trim(),
                id_no: idNumber
            }
        });

        if (result.access_token) {
            await verifySavedProfile(result.access_token, idNumber);
            storeSupabaseSession(result);
            form.reset();
            setMessage(message, "Registration complete. Your account is ready.", "success");
            await loadAccountStatus();
            window.location.href = "forms.html";
        } else {
            form.reset();
            const loginForm = document.getElementById("loginForm");
            loginForm.elements.id_no.value = idNumber;
            showAccountPanel("login", true);
            setMessage(
                document.getElementById("loginMessage"),
                "Account created. Sign in with your ID number and password.",
                "success"
            );
        }
    } catch (error) {
        console.error("Error registering with Supabase:", error);
        setMessage(message, error.message || "Unable to register. Please try again.", "error");
    } finally {
        submitButton.disabled = false;
    }
}

async function loginWithSupabase(form) {
    const message = document.getElementById("loginMessage");
    const submitButton = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    const idNumber = String(values.get("id_no")).trim();
    if (!/^[0-9]+$/.test(idNumber)) {
        setMessage(message, "ID number must contain digits only.", "error");
        return;
    }
    submitButton.disabled = true;
    setMessage(message, "Signing in...", "");

    try {
        const result = await supabaseRequest("/functions/v1/login-with-id", {
            method: "POST",
            body: {
                id_no: idNumber,
                password: String(values.get("password"))
            }
        });
        await verifySavedProfile(result.access_token, idNumber);
        storeSupabaseSession(result);
        form.reset();
        sessionStorage.setItem("communityReportingLoginSuccess", "true");
        window.location.href = "forms.html";
    } catch (error) {
        console.error("Error signing in with Supabase:", error);
        const errorMessage = error.message || "";
        const isMissingFunction = errorMessage.toLowerCase().includes("requested function was not found");
        setMessage(
            message,
            isMissingFunction
                ? "Sign-in service is unavailable. Please try again later or contact support."
                : errorMessage || "Unable to sign in. Please try again.",
            "error"
        );
    } finally {
        submitButton.disabled = false;
    }
}

async function deleteAccountFromWeb(form) {
    const message = document.getElementById("deleteAccountMessage");
    const submitButton = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    const idNumber = String(values.get("id_no")).trim();
    if (!/^[0-9]+$/.test(idNumber)) {
        setMessage(message, "ID number must contain digits only.", "error");
        return;
    }
    if (!window.confirm("Permanently delete your account, reports, and attachments? This cannot be undone.")) {
        return;
    }

    submitButton.disabled = true;
    setMessage(message, "Verifying your account and deleting your data...", "");
    try {
        const session = await supabaseRequest("/functions/v1/login-with-id", {
            method: "POST",
            body: {
                id_no: idNumber,
                password: String(values.get("password"))
            }
        });
        await supabaseRequest("/functions/v1/delete-account", {
            method: "POST",
            token: session.access_token,
            body: {}
        });
        localStorage.removeItem(supabaseSessionKey);
        sessionStorage.removeItem(supabaseSessionKey);
        form.reset();
        setMessage(message, "Your account, reports, and attachments have been permanently deleted.", "success");
    } catch (error) {
        console.error("Error deleting account from the web request page:", error);
        setMessage(message, error.message || "Unable to delete your account. Please try again.", "error");
    } finally {
        submitButton.disabled = false;
    }
}

async function submitReportForm(form) {
    const message = document.getElementById("reportMessage");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setMessage(message, "Submitting report and attachments...", "");
    let reportId = null;
    let accessToken = null;
    const uploadedPaths = [];

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Sign in before submitting a report.");
        }
        accessToken = session.access_token;
        setMessage(message, "Getting a fresh GPS location for your report...", "");
        await captureReportLocation();
        const formData = new FormData(form);
        const latitude = Number(formData.get("latitude"));
        const longitude = Number(formData.get("longitude"));
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new Error("A valid GPS location is required. Allow location access and try again.");
        }
        const reportRows = await supabaseRequest("/rest/v1/reports?select=id", {
            method: "POST",
            token: session.access_token,
            headers: { Prefer: "return=representation" },
            body: {
                title: String(formData.get("title")).trim(),
                category: String(formData.get("category")),
                location: String(formData.get("location")).trim(),
                latitude,
                longitude,
                description: String(formData.get("description")).trim()
            }
        });
        reportId = reportRows[0].id;

        const attachmentRows = [];
        for (const file of reportAttachments) {
            const safeName = file.name.replace(/[^\w.-]/g, "_").slice(-100) || "attachment";
            const storagePath = `${reportId}/${crypto.randomUUID()}-${safeName}`;
            await supabaseRequest(`/storage/v1/object/report-attachments/${encodeStoragePath(storagePath)}`, {
                method: "POST",
                token: session.access_token,
                headers: {
                    "Content-Type": file.type,
                    "x-upsert": "false"
                },
                rawBody: file
            });
            uploadedPaths.push(storagePath);
            attachmentRows.push({
                report_id: reportId,
                storage_path: storagePath,
                original_name: file.name.slice(0, 255),
                mime_type: file.type,
                file_size: file.size
            });
        }

        if (attachmentRows.length > 0) {
            await supabaseRequest("/rest/v1/report_attachments", {
                method: "POST",
                token: session.access_token,
                body: attachmentRows
            });
        }

        let notificationFailed = false;
        try {
            await supabaseRequest("/functions/v1/report-notification", {
                method: "POST",
                token: session.access_token,
                body: { report_id: reportId }
            });
        } catch (notificationError) {
            notificationFailed = true;
            console.error("The report was saved, but the administrator email failed:", notificationError);
        }

        form.reset();
        reportAttachments.length = 0;
        renderAttachmentList();
        document.getElementById("stopCamera").click();
        window.location.href = `solutions.html?report=${notificationFailed ? "email-failed" : "submitted"}`;
    } catch (error) {
        if (reportId && accessToken) {
            await removeSupabaseObjects(uploadedPaths, accessToken);
            try {
                await supabaseRequest(`/rest/v1/reports?id=eq.${encodeURIComponent(reportId)}`, {
                    method: "DELETE",
                    token: accessToken
                });
            } catch (cleanupError) {
                console.error("Could not remove the incomplete report:", cleanupError);
            }
        }
        console.error("Error submitting report:", error);
        setMessage(message, error.message || "Unable to contact the server. Please try again.", "error");
    } finally {
        submitButton.disabled = false;
    }
}

async function captureReportLocation() {
    const locationInput = document.getElementById("location");
    const latitudeInput = document.getElementById("latitude");
    const longitudeInput = document.getElementById("longitude");
    const message = document.getElementById("locationMessage");
    const previewMap = document.getElementById("locationPreviewMap");
    try {
        setMessage(message, "Finding your location...", "");

        let position;
        if (window.Capacitor?.isNativePlatform?.()) {
            await import("./gps.js");
            position = await window.communityGeolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            });
        } else {
            if (!navigator.geolocation) {
                throw new Error("Location is not available in this browser.");
            }
            position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 20000,
                    maximumAge: 0
                });
            });
        }

        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new Error("Your device returned invalid GPS coordinates.");
        }

        latitudeInput.value = String(latitude);
        longitudeInput.value = String(longitude);
        const coordinateText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        if (!locationInput.value.trim()) {
            locationInput.value = `GPS coordinates: ${coordinateText}`;
        }
        previewMap.href = `https://www.google.com/maps?q=${encodeURIComponent(coordinateText)}`;
        previewMap.hidden = false;
        setMessage(message, `GPS location attached (${coordinateText}).`, "success");
    } catch (error) {
        setMessage(
            message,
            error.message || "Could not get your location. Allow location access and try again.",
            "error"
        );
        throw error;
    }
}

function encodeStoragePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
}

async function removeSupabaseObjects(paths, accessToken) {
    if (!accessToken) {
        return;
    }
    for (const path of paths) {
        try {
            await supabaseRequest(`/storage/v1/object/report-attachments/${encodeStoragePath(path)}`, {
                method: "DELETE",
                token: accessToken
            });
        } catch (error) {
            console.error("Could not clean up a partially uploaded attachment:", error);
        }
    }
}

function initializeAttachments() {
    const input = document.getElementById("reportFiles");
    input.addEventListener("change", () => {
        const message = document.getElementById("cameraMessage");
        const newFiles = Array.from(input.files);
        input.value = "";

        for (const file of newFiles) {
            if (!allowedAttachmentTypes.has(file.type)) {
                setMessage(message, `${file.name}: this file type is not supported.`, "error");
                continue;
            }
            if (file.size > maximumAttachmentSize) {
                setMessage(message, `${file.name}: files must be 25 MB or smaller.`, "error");
                continue;
            }
            if (getTotalAttachmentSize() + file.size > maximumTotalAttachmentSize) {
                setMessage(message, "Attachments must total no more than 50 MB.", "error");
                continue;
            }
            if (reportAttachments.length >= maximumAttachments) {
                setMessage(message, "You can attach up to 5 files to one report.", "error");
                break;
            }
            reportAttachments.push(file);
        }

        renderAttachmentList();
    });
}

function renderAttachmentList() {
    const list = document.getElementById("attachmentList");
    if (!list) {
        return;
    }

    list.replaceChildren();
    reportAttachments.forEach((file, index) => {
        const item = document.createElement("li");
        item.className = "attachment-item";
        const name = document.createElement("span");
        name.textContent = `${file.name} (${formatFileSize(file.size)})`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.addEventListener("click", () => {
            reportAttachments.splice(index, 1);
            renderAttachmentList();
        });
        item.append(name, remove);
        list.append(item);
    });
}

function formatFileSize(bytes) {
    return bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getTotalAttachmentSize() {
    return reportAttachments.reduce((total, file) => total + file.size, 0);
}

function initializeCamera() {
    const preview = document.getElementById("cameraPreview");
    const openButton = document.getElementById("startCamera");
    const photoButton = document.getElementById("takePhoto");
    const videoButton = document.getElementById("recordVideo");
    const audioButton = document.getElementById("recordAudio");
    const closeButton = document.getElementById("stopCamera");
    const panel = document.getElementById("capturePanel");
    const message = document.getElementById("cameraMessage");
    let cameraStream = null;
    let audioStream = null;
    let recorder = null;
    let recordedChunks = [];
    let recordingKind = null;
    let cameraRequestId = 0;

    const updateRecordingControls = () => {
        const isRecording = Boolean(recorder && recorder.state === "recording");
        photoButton.disabled = !cameraStream || isRecording;
        videoButton.disabled = !cameraStream || (isRecording && recordingKind !== "video");
        audioButton.disabled = typeof MediaRecorder === "undefined" || (isRecording && recordingKind !== "audio");
        closeButton.disabled = isRecording;
    };

    const closeCaptureTools = () => {
        cameraRequestId++;
        if (recorder && recorder.state !== "inactive") {
            recorder.stop();
        }
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }
        if (audioStream) {
            audioStream.getTracks().forEach((track) => track.stop());
            audioStream = null;
        }
        preview.srcObject = null;
        preview.hidden = true;
        photoButton.disabled = true;
        videoButton.disabled = true;
        audioButton.disabled = typeof MediaRecorder === "undefined";
        videoButton.textContent = "Start video";
        audioButton.textContent = "Record audio";
        closeButton.disabled = false;
        panel.hidden = true;
        openButton.disabled = false;
        openButton.setAttribute("aria-expanded", "false");
    };

    openButton.addEventListener("click", async () => {
        panel.hidden = false;
        openButton.setAttribute("aria-expanded", "true");
        openButton.disabled = true;
        closeButton.disabled = false;
        audioButton.disabled = typeof MediaRecorder === "undefined";
        const requestId = ++cameraRequestId;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setMessage(message, "Camera access requires HTTPS or localhost. Audio recording may still be available.", "error");
            openButton.disabled = false;
            closeButton.disabled = false;
            return;
        }

        setMessage(message, "Requesting camera permission...", "");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (requestId !== cameraRequestId || panel.hidden) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            cameraStream = stream;
            preview.srcObject = cameraStream;
            preview.hidden = false;
            updateRecordingControls();
            if (typeof MediaRecorder === "undefined") {
                setMessage(message, "Camera preview is ready. Recording is not supported by this browser.", "error");
            } else {
                setMessage(message, "Choose whether to take a photo, record video, or record audio.", "success");
            }
        } catch (error) {
            console.error("Unable to open camera:", error);
            if (requestId !== cameraRequestId || panel.hidden) {
                return;
            }
            cameraStream = null;
            openButton.disabled = false;
            closeButton.disabled = false;
            setMessage(message, "Could not open the camera. You can still record audio or upload files. Check browser permission and make sure no other app is using the camera.", "error");
        }
    });

    photoButton.addEventListener("click", () => {
        const videoTrack = cameraStream && cameraStream.getVideoTracks()[0];
        if (!videoTrack || videoTrack.readyState !== "live" || preview.videoWidth === 0) {
            setMessage(message, "The camera is not ready to take a photo.", "error");
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = preview.videoWidth;
        canvas.height = preview.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) {
            setMessage(message, "The photo could not be created. Please try again.", "error");
            return;
        }
        context.drawImage(preview, 0, 0);
        canvas.toBlob((blob) => {
            if (!blob) {
                setMessage(message, "The photo could not be created. Please try again.", "error");
                return;
            }
            addCameraAttachment(blob, "camera-photo.jpg", "image/jpeg", message);
        }, "image/jpeg", 0.9);
    });

    const startRecording = (stream, kind) => {
        if (recorder && recorder.state === "recording") {
            if (recordingKind === kind) {
                recorder.stop();
            }
            return;
        }

        if (!stream || typeof MediaRecorder === "undefined") {
            setMessage(message, `${kind === "audio" ? "Audio" : "Video"} recording is not available.`, "error");
            return;
        }

        const preferredTypes = kind === "audio"
            ? ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
            : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4"];
        const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
        try {
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            recordedChunks = [];
            recordingKind = kind;
            recorder.addEventListener("dataavailable", (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            });
            recorder.addEventListener("stop", () => {
                cameraRecording = false;
                const completedKind = recordingKind;
                recordingKind = null;
                videoButton.textContent = "Start video";
                audioButton.textContent = "Record audio";
                if (completedKind === "audio" && audioStream) {
                    audioStream.getTracks().forEach((track) => track.stop());
                    audioStream = null;
                }
                updateRecordingControls();
                if (recordedChunks.length === 0) {
                    setMessage(message, `No ${completedKind} was recorded. Please try again.`, "error");
                    return;
                }
                if (recordedChunks.reduce((total, chunk) => total + chunk.size, 0) > maximumAttachmentSize) {
                    setMessage(message, `The ${completedKind} is larger than 25 MB. Record a shorter ${completedKind} and try again.`, "error");
                    recordedChunks = [];
                    return;
                }
                const type = (recorder.mimeType || `${completedKind}/webm`).split(";")[0];
                const extension = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
                const blob = new Blob(recordedChunks, { type });
                addCameraAttachment(blob, `camera-${completedKind}-${Date.now()}.${extension}`, type, message);
                recordedChunks = [];
            }, { once: true });
            recorder.start(1000);
            cameraRecording = true;
            if (kind === "video") {
                videoButton.textContent = "Stop video";
            } else {
                audioButton.textContent = "Stop audio";
            }
            updateRecordingControls();
            setMessage(message, `Recording ${kind}... Select Stop ${kind} when you are done.`, "");
        } catch (error) {
            console.error(`Unable to start ${kind} recording:`, error);
            if (kind === "audio" && audioStream) {
                audioStream.getTracks().forEach((track) => track.stop());
                audioStream = null;
            }
            setMessage(message, `${kind[0].toUpperCase()}${kind.slice(1)} recording could not be started on this device.`, "error");
        }
    };

    videoButton.addEventListener("click", () => startRecording(cameraStream, "video"));
    audioButton.addEventListener("click", async () => {
        if (recorder && recorder.state === "recording") {
            startRecording(audioStream, "audio");
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setMessage(message, "Audio recording requires HTTPS or localhost and a supported browser.", "error");
            return;
        }
        try {
            audioButton.disabled = true;
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (recorder && recorder.state === "recording") {
                audioStream.getTracks().forEach((track) => track.stop());
                audioStream = null;
                setMessage(message, "Stop the video recording before starting an audio recording.", "error");
                return;
            }
            startRecording(audioStream, "audio");
        } catch (error) {
            console.error("Unable to open microphone:", error);
            audioStream = null;
            setMessage(message, "Could not access the microphone. Check browser permission and try again.", "error");
        } finally {
            audioButton.disabled = typeof MediaRecorder === "undefined" || Boolean(recorder && recorder.state === "recording" && recordingKind !== "audio");
        }
    });

    closeButton.addEventListener("click", closeCaptureTools);
    window.addEventListener("pagehide", closeCaptureTools);
}

function addCameraAttachment(blob, filename, type, message) {
    if (reportAttachments.length >= maximumAttachments) {
        setMessage(message, "You can attach up to 5 files to one report. Remove an attachment before adding another.", "error");
        return;
    }
    if (getTotalAttachmentSize() + blob.size > maximumTotalAttachmentSize) {
        setMessage(message, "Attachments must total no more than 50 MB.", "error");
        return;
    }
    if (blob.size > maximumAttachmentSize) {
        setMessage(message, "This recording is larger than 25 MB. Record a shorter video or attach a smaller file.", "error");
        return;
    }

    reportAttachments.push(new File([blob], filename, { type }));
    renderAttachmentList();
    setMessage(message, `${filename} added to your report.`, "success");
}

async function loadSolutions() {
    const container = document.getElementById("solutionsContainer");

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Sign in to view reports and responses.");
        }
        const reports = await supabaseRequest(
            "/rest/v1/reports?select=*,report_attachments(*),report_solutions(*),report_messages(*)&report_messages.order=created_at.asc&order=created_at.desc",
            { token: session.access_token }
        );
        const reporterPhones = new Map();
        let reporterPhoneLookupFailed = false;
        if (currentUserIsAdmin && reports.length > 0) {
            const reporterIds = [...new Set(reports
                .map((report) => report.user_id)
                .filter((userId) => typeof userId === "string" && userId.length > 0))];
            try {
                for (let offset = 0; offset < reporterIds.length; offset += 80) {
                    const ids = reporterIds.slice(offset, offset + 80);
                    const query = new URLSearchParams({
                        select: "id,phone_number",
                        id: `in.(${ids.join(",")})`
                    });
                    const profiles = await supabaseRequest(`/rest/v1/profiles?${query}`, {
                        token: session.access_token
                    });
                    profiles.forEach((profile) => reporterPhones.set(profile.id, profile.phone_number));
                }
            } catch (error) {
                reporterPhoneLookupFailed = true;
                console.error("Unable to load registered reporter phone numbers:", error);
            }
        }

        container.replaceChildren();
        if (reports.length === 0) {
            container.append(createEmptyState("No reports have been submitted yet."));
            return;
        }

        const cards = await Promise.all(reports.map(async (report) => {
            const solution = Array.isArray(report.report_solutions)
                ? report.report_solutions[0] || null
                : report.report_solutions;
            const mappedReport = {
                ...report,
                reporter_phone: reporterPhones.get(report.user_id) || "",
                reporter_phone_lookup_failed: reporterPhoneLookupFailed,
                attachments: report.report_attachments || [],
                messages: report.report_messages || [],
                solution: solution ? {
                    response: solution.response_text,
                    action_taken: solution.action_taken,
                    status: solution.status,
                    responded_at: solution.created_at,
                    reference_file: solution.reference_file_path ? {
                        path: solution.reference_file_path,
                        storage_path: solution.reference_file_path,
                        name: solution.reference_file_name,
                        type: solution.reference_mime_type,
                        report_id: report.id,
                        kind: "solution"
                    } : null
                } : null
            };
            mappedReport.attachments = await Promise.all(mappedReport.attachments.map((attachment) =>
                createSignedAttachment({ ...attachment, kind: "report" })
            ));
            if (mappedReport.solution && mappedReport.solution.reference_file) {
                mappedReport.solution.reference_file = await createSignedAttachment(mappedReport.solution.reference_file);
            }
            return createReportCard(mappedReport);
        }));
        container.append(...cards);
    } catch (error) {
        console.error("Error loading community solutions:", error);
        container.replaceChildren(createEmptyState(error.message || "Solutions could not be loaded. Please try again later."));
    }
}

async function loadCommunityThoughts() {
    const container = document.getElementById("thoughtsContainer");
    if (!container) {
        return;
    }

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Sign in to view residents' thoughts.");
        }
        const thoughts = await supabaseRequest(
            "/rest/v1/community_thoughts?select=id,thought,created_at&order=created_at.desc&limit=100",
            { token: session.access_token }
        );

        container.replaceChildren();
        if (thoughts.length === 0) {
            container.append(createEmptyState("No thoughts shared yet. Be the first to contribute."));
            return;
        }

        thoughts.forEach((thought) => {
            const card = document.createElement("article");
            card.className = "thought-card";
            const text = document.createElement("p");
            text.textContent = thought.thought;
            const date = document.createElement("small");
            const createdAt = new Date(thought.created_at);
            date.textContent = Number.isNaN(createdAt.getTime())
                ? "Date unavailable"
                : createdAt.toLocaleString();
            card.append(text, date);
            container.append(card);
        });
    } catch (error) {
        console.error("Error loading residents' thoughts:", error);
        container.replaceChildren(createEmptyState(
            error.message || "Residents' thoughts could not be loaded. Please try again later."
        ));
    }
}

async function submitThoughtForm(form) {
    const message = document.getElementById("thoughtMessage");
    const submitButton = form.querySelector('button[type="submit"]');
    const thought = String(new FormData(form).get("thought") || "").trim();
    if (!thought || thought.length > 3000) {
        setMessage(message, "Enter your thoughts using no more than 3,000 characters.", "error");
        return;
    }

    submitButton.disabled = true;
    setMessage(message, "Sharing your thoughts...", "");
    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Your session has expired. Sign in again to share your thoughts.");
        }
        await supabaseRequest("/rest/v1/community_thoughts", {
            method: "POST",
            token: session.access_token,
            body: { thought }
        });
        form.reset();
        setMessage(message, "Your thoughts have been shared with the community.", "success");
        await loadCommunityThoughts();
    } catch (error) {
        console.error("Error sharing residents' thoughts:", error);
        setMessage(message, error.message || "Your thoughts could not be shared. Please try again.", "error");
    } finally {
        submitButton.disabled = false;
    }
}

async function createSignedAttachment(attachment) {
    const session = await getSupabaseSession();
    if (!session || !session.access_token) {
        throw new Error("Sign in to view report attachments.");
    }
    const result = await supabaseRequest(
        `/storage/v1/object/sign/report-attachments/${encodeStoragePath(attachment.storage_path || attachment.path)}`,
        {
            method: "POST",
            token: session.access_token,
            body: { expiresIn: 3600 }
        }
    );
    const signedPath = result.signedURL || result.signedUrl;
    if (!signedPath) {
        throw new Error("Supabase did not return a signed attachment link.");
    }
    return {
        ...attachment,
        path: signedPath.startsWith("http") ? signedPath : `${supabaseUrl}/storage/v1${signedPath}`
    };
}

async function loadResidentDirectory() {
    const section = document.getElementById("residentDirectory");
    const list = document.getElementById("residentList");
    const message = document.getElementById("residentMessage");
    if (!section || !list || !message || !currentUserIsAdmin) {
        return;
    }

    section.hidden = false;
    setMessage(message, "Loading registered residents...", "");
    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Your session has expired. Sign in again to view the resident list.");
        }
        const residents = await supabaseRequest(
            "/rest/v1/profiles?select=first_name,second_name,last_name,id_no&order=last_name.asc,first_name.asc",
            { token: session.access_token }
        );

        list.replaceChildren();
        if (residents.length === 0) {
            list.append(createEmptyState("No residents have registered yet."));
        } else {
            residents.forEach((resident) => {
                const item = document.createElement("li");
                item.className = "resident-item";
                const name = [resident.first_name, resident.second_name, resident.last_name]
                    .filter(Boolean)
                    .join(" ") || "Name not provided";
                const nameText = document.createElement("span");
                nameText.textContent = name;
                const idText = document.createElement("span");
                idText.textContent = `ID number: ${resident.id_no || "Not provided"}`;
                item.append(nameText, idText);
                list.append(item);
            });
        }
        setMessage(message, `${residents.length} registered resident${residents.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
        console.error("Unable to load registered residents:", error);
        list.replaceChildren();
        setMessage(message, error.message || "The resident list could not be loaded.", "error");
    }
}

function createReportCard(report) {
    const card = document.createElement("article");
    card.className = "report-card";

    const title = document.createElement("h3");
    title.textContent = report.title;
    card.append(title);

    appendReportDetail(card, "Report type", report.category);
    appendReportDetail(card, "Location", report.location);
    if (currentUserIsAdmin) {
        appendReportDetail(
            card,
            "Reporter phone",
            report.reporter_phone_lookup_failed
                ? "Could not be loaded"
                : report.reporter_phone || "Not available"
        );
    }
    const latitude = Number(report.latitude);
    const longitude = Number(report.longitude);
    if (report.latitude !== null && report.latitude !== undefined
        && report.longitude !== null && report.longitude !== undefined
        && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
        const mapLink = document.createElement("a");
        mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
        mapLink.target = "_blank";
        mapLink.rel = "noopener noreferrer";
        mapLink.textContent = "Open larger map";
        const mapFrame = document.createElement("iframe");
        const bounds = [
            Math.max(-180, longitude - 0.01),
            Math.max(-90, latitude - 0.01),
            Math.min(180, longitude + 0.01),
            Math.min(90, latitude + 0.01)
        ];
        const mapUrl = new URL("https://www.openstreetmap.org/export/embed.html");
        mapUrl.searchParams.set("bbox", bounds.join(","));
        mapUrl.searchParams.set("layer", "mapnik");
        mapUrl.searchParams.set("marker", `${latitude},${longitude}`);
        const mapToggle = document.createElement("button");
        mapToggle.type = "button";
        mapToggle.className = "secondary-button report-gps-toggle";
        mapToggle.setAttribute("aria-expanded", "false");
        const mapToggleText = document.createElement("span");
        mapToggleText.textContent = "Show GPS location";
        mapToggle.append(createGpsIcon(), mapToggleText);
        mapFrame.className = "report-location-map";
        mapFrame.title = `Map showing GPS location for ${report.title}`;
        mapFrame.loading = "lazy";
        mapFrame.referrerPolicy = "no-referrer";
        mapFrame.hidden = true;
        mapToggle.addEventListener("click", () => {
            const isExpanded = mapToggle.getAttribute("aria-expanded") === "true";
            mapToggle.setAttribute("aria-expanded", String(!isExpanded));
            mapFrame.hidden = isExpanded;
            mapToggleText.textContent = isExpanded ? "Show GPS location" : "Hide GPS location";
            if (!isExpanded && !mapFrame.hasAttribute("src")) {
                mapFrame.src = mapUrl.toString();
            }
        });
        card.append(mapToggle, mapFrame, mapLink);
    } else {
        const gpsUnavailable = document.createElement("p");
        gpsUnavailable.className = "report-gps-unavailable";
        gpsUnavailable.append(
            createGpsIcon(),
            document.createTextNode("GPS location was not recorded for this report.")
        );
        card.append(gpsUnavailable);
    }

    const description = document.createElement("p");
    description.textContent = report.description;
    card.append(description);

    const date = document.createElement("p");
    const dateText = document.createElement("small");
    const createdAt = new Date(report.created_at);
    dateText.textContent = `Reported: ${Number.isNaN(createdAt.getTime()) ? "Date unavailable" : createdAt.toLocaleString()}`;
    date.append(dateText);
    card.append(date);

    const badge = document.createElement("span");
    badge.className = "badge";
    const displayedStatus = report.solution
        ? report.solution.status
        : (report.status || "Awaiting first response");
    badge.textContent = displayedStatus;
    if (displayedStatus === "In Progress") {
        badge.classList.add("in-progress");
    }
    card.append(badge);

    (report.attachments || []).forEach((attachment) => {
        appendAttachment(card, attachment, "Report attachment", currentUserIsAdmin);
    });

    const responseId = `report-response-${report.id}`;
    const solutionSection = document.createElement("section");
    solutionSection.className = "solution-response";
    solutionSection.id = responseId;
    solutionSection.hidden = true;
    const solutionHeading = document.createElement("h4");
    solutionHeading.textContent = "Responses and updates";
    solutionSection.append(solutionHeading);

    if (report.solution) {
        appendReportDetail(solutionSection, "Response", report.solution.response);
        appendReportDetail(solutionSection, "Action taken", report.solution.action_taken);

        if (report.solution.responded_at) {
            const responseDate = document.createElement("p");
            const dateText = document.createElement("small");
            const parsedDate = new Date(report.solution.responded_at);
            dateText.textContent = `First response: ${Number.isNaN(parsedDate.getTime()) ? "Date unavailable" : parsedDate.toLocaleString()}`;
            responseDate.append(dateText);
            solutionSection.append(responseDate);
        }

        if (report.solution.reference_file) {
            appendAttachment(solutionSection, report.solution.reference_file, "Action reference", currentUserIsAdmin);
        }
    } else if (!report.messages || report.messages.length === 0) {
        const awaiting = document.createElement("p");
        awaiting.className = "awaiting-response";
        awaiting.textContent = "No response yet. This report is awaiting its first official response.";
        solutionSection.append(awaiting);
    }

    if (report.messages && report.messages.length > 0) {
        const messageList = document.createElement("div");
        messageList.className = "report-message-list";
        report.messages.forEach((reportMessage) => {
            const messageCard = document.createElement("article");
            messageCard.className = "report-message";
            const messageText = document.createElement("p");
            messageText.textContent = reportMessage.message;
            const messageDate = document.createElement("small");
            const parsedDate = new Date(reportMessage.created_at);
            messageDate.textContent = `Administrator reply · ${
                Number.isNaN(parsedDate.getTime()) ? "Date unavailable" : parsedDate.toLocaleString()
            }`;
            messageCard.append(messageText, messageDate);
            messageList.append(messageCard);
        });
        solutionSection.append(messageList);
    }

    const responseActions = document.createElement("div");
    responseActions.className = "solution-actions";

    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.className = "secondary-button";
    readButton.textContent = "Read responses";
    readButton.setAttribute("aria-expanded", "false");
    readButton.setAttribute("aria-controls", responseId);
    readButton.addEventListener("click", () => {
        const isExpanded = readButton.getAttribute("aria-expanded") === "true";
        readButton.setAttribute("aria-expanded", String(!isExpanded));
        readButton.textContent = isExpanded ? "Read responses" : "Hide responses";
        solutionSection.hidden = isExpanded;
    });
    responseActions.append(readButton);

    let writePanel = null;
    if (currentUserIsAdmin && !report.solution) {
        const writeButton = document.createElement("button");
        writeButton.type = "button";
        writeButton.className = "secondary-button";
        writeButton.textContent = "Write response";
        writeButton.setAttribute("aria-expanded", "false");
        writePanel = document.createElement("section");
        writePanel.className = "solution-write-panel";
        writePanel.hidden = true;
        const writeHeading = document.createElement("h4");
        writeHeading.textContent = "Write the first response";
        writePanel.append(writeHeading, createSolutionForm(report));

        writeButton.addEventListener("click", () => {
            const isExpanded = writeButton.getAttribute("aria-expanded") === "true";
            writeButton.setAttribute("aria-expanded", String(!isExpanded));
            writeButton.textContent = isExpanded ? "Write response" : "Close response form";
            writePanel.hidden = isExpanded;
        });
        responseActions.append(writeButton);
    }

    let replyPanel = null;
    if (currentUserIsAdmin) {
        const replyButton = document.createElement("button");
        replyButton.type = "button";
        replyButton.className = "secondary-button";
        replyButton.textContent = "Reply to report";
        replyButton.setAttribute("aria-expanded", "false");
        replyPanel = document.createElement("section");
        replyPanel.className = "solution-write-panel";
        replyPanel.hidden = true;
        const replyHeading = document.createElement("h4");
        replyHeading.textContent = "Send an official reply";
        replyPanel.append(replyHeading, createReportMessageForm(report));

        replyButton.addEventListener("click", () => {
            const isExpanded = replyButton.getAttribute("aria-expanded") === "true";
            replyButton.setAttribute("aria-expanded", String(!isExpanded));
            replyButton.textContent = isExpanded ? "Reply to report" : "Close reply form";
            replyPanel.hidden = isExpanded;
        });
        responseActions.append(replyButton);
    }

    card.append(responseActions, solutionSection);
    if (writePanel) {
        card.append(writePanel);
    }
    if (replyPanel) {
        card.append(replyPanel);
    }

    return card;
}

function appendAttachment(container, attachment, label, canManage = false) {
    const media = document.createElement("div");
    media.className = "report-attachment";
    media.dataset.attachmentId = attachment.id || attachment.report_id;

    if (attachment.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = attachment.path;
        image.alt = `${label}: ${attachment.name}`;
        image.loading = "lazy";
        media.append(image);
    } else if (attachment.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.src = attachment.path;
        video.controls = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", `${label}: ${attachment.name}`);
        media.append(video);
    } else if (attachment.type.startsWith("audio/")) {
        const audio = document.createElement("audio");
        audio.src = attachment.path;
        audio.controls = true;
        audio.preload = "metadata";
        audio.setAttribute("aria-label", `${label}: ${attachment.name}`);
        media.append(audio);
    } else {
        const link = document.createElement("a");
        link.href = attachment.path;
        link.textContent = `${label}: ${attachment.name}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        media.append(link);
    }

    if (canManage) {
        media.append(createAttachmentManagementControls(attachment, media));
    }
    container.append(media);
}

function createAttachmentManagementControls(attachment, attachmentElement) {
    const controls = document.createElement("div");
    controls.className = "attachment-management";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button";
    editButton.textContent = "Edit";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`Delete "${attachment.name}"? This cannot be undone.`)) {
            return;
        }
        editButton.disabled = true;
        deleteButton.disabled = true;
        try {
            await deleteSavedAttachment(attachment);
            attachmentElement.remove();
        } catch (error) {
            console.error("Unable to delete saved attachment:", error);
            window.alert(error.message || "The file could not be deleted.");
            editButton.disabled = false;
            deleteButton.disabled = false;
        }
    });

    const editForm = document.createElement("form");
    editForm.className = "attachment-edit-form";
    editForm.hidden = true;
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "File name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 255;
    nameInput.required = true;
    nameInput.value = attachment.name;
    nameLabel.append(nameInput);

    const fileLabel = document.createElement("label");
    fileLabel.textContent = "Replace file (optional)";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = Array.from(allowedAttachmentTypes).join(",");
    fileLabel.append(fileInput);

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "secondary-button";
    saveButton.textContent = "Save changes";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary-button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
        editForm.hidden = true;
        editButton.hidden = false;
        deleteButton.hidden = false;
    });

    editButton.addEventListener("click", () => {
        editForm.hidden = false;
        editButton.hidden = true;
        deleteButton.hidden = true;
        nameInput.focus();
    });

    editForm.append(nameLabel, fileLabel, saveButton, cancelButton);
    editForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const replacement = fileInput.files[0] || null;
        if (replacement && (
            !allowedAttachmentTypes.has(replacement.type) ||
            replacement.size < 1 ||
            replacement.size > maximumAttachmentSize
        )) {
            window.alert("Choose a supported file no larger than 25 MB.");
            return;
        }
        if (!nameInput.value.trim()) {
            nameInput.focus();
            return;
        }

        saveButton.disabled = true;
        cancelButton.disabled = true;
        try {
            await updateSavedAttachment(attachment, nameInput.value.trim(), replacement);
            await loadSolutions();
        } catch (error) {
            console.error("Unable to update saved attachment:", error);
            window.alert(error.message || "The file changes could not be saved.");
            saveButton.disabled = false;
            cancelButton.disabled = false;
        }
    });

    controls.append(editButton, deleteButton, editForm);
    return controls;
}

async function updateSavedAttachment(attachment, name, replacement) {
    const session = await getSupabaseSession();
    if (!session || !session.access_token || !currentUserIsAdmin) {
        throw new Error("Only an administrator can edit saved files.");
    }

    let newPath = attachment.storage_path;
    if (replacement) {
        newPath = `${attachment.kind === "solution" ? "solutions/" : ""}${attachment.report_id}/${crypto.randomUUID()}-${replacement.name.replace(/[^\w.-]/g, "_").slice(-100) || "attachment"}`;
        await supabaseRequest(`/storage/v1/object/report-attachments/${encodeStoragePath(newPath)}`, {
            method: "POST",
            token: session.access_token,
            headers: {
                "Content-Type": replacement.type,
                "x-upsert": "false"
            },
            rawBody: replacement
        });
    }

    try {
        if (attachment.kind === "solution") {
            await supabaseRequest(`/rest/v1/report_solutions?report_id=eq.${encodeURIComponent(attachment.report_id)}`, {
                method: "PATCH",
                token: session.access_token,
                body: {
                    reference_file_path: newPath,
                    reference_file_name: name,
                    reference_mime_type: replacement ? replacement.type : attachment.type
                }
            });
        } else {
            await supabaseRequest(`/rest/v1/report_attachments?id=eq.${encodeURIComponent(attachment.id)}`, {
                method: "PATCH",
                token: session.access_token,
                body: {
                    storage_path: newPath,
                    original_name: name,
                    mime_type: replacement ? replacement.type : attachment.type,
                    file_size: replacement ? replacement.size : attachment.file_size
                }
            });
        }
    } catch (error) {
        if (replacement) {
            await removeSupabaseObjects([newPath], session.access_token);
        }
        throw error;
    }

    if (replacement && attachment.storage_path !== newPath) {
        await removeSupabaseObjects([attachment.storage_path], session.access_token);
    }
}

async function deleteSavedAttachment(attachment) {
    const session = await getSupabaseSession();
    if (!session || !session.access_token || !currentUserIsAdmin) {
        throw new Error("Only an administrator can delete saved files.");
    }

    if (attachment.kind === "solution") {
        await supabaseRequest(`/rest/v1/report_solutions?report_id=eq.${encodeURIComponent(attachment.report_id)}`, {
            method: "PATCH",
            token: session.access_token,
            body: {
                reference_file_path: null,
                reference_file_name: null,
                reference_mime_type: null
            }
        });
    } else {
        await supabaseRequest(`/rest/v1/report_attachments?id=eq.${encodeURIComponent(attachment.id)}`, {
            method: "DELETE",
            token: session.access_token
        });
    }
    await removeSupabaseObjects([attachment.storage_path], session.access_token);
}

function createSolutionForm(report) {
    const form = document.createElement("form");
    form.className = "solution-form";
    form.dataset.reportId = report.id;

    const responseGroup = document.createElement("div");
    responseGroup.className = "form-group";
    const responseLabel = document.createElement("label");
    responseLabel.htmlFor = `solutionResponse-${report.id}`;
    responseLabel.textContent = "First response";
    const responseInput = document.createElement("textarea");
    responseInput.id = responseLabel.htmlFor;
    responseInput.name = "response_text";
    responseInput.rows = 3;
    responseInput.maxLength = 5000;
    responseInput.required = true;
    responseInput.placeholder = "Write the first official response to this report...";
    responseGroup.append(responseLabel, responseInput);

    const actionGroup = document.createElement("div");
    actionGroup.className = "form-group";
    const actionLabel = document.createElement("label");
    actionLabel.htmlFor = `actionTaken-${report.id}`;
    actionLabel.textContent = "Action taken";
    const actionInput = document.createElement("textarea");
    actionInput.id = actionLabel.htmlFor;
    actionInput.name = "action_taken";
    actionInput.rows = 3;
    actionInput.maxLength = 5000;
    actionInput.required = true;
    actionInput.placeholder = "Describe the action taken or planned...";
    actionGroup.append(actionLabel, actionInput);

    const statusGroup = document.createElement("div");
    statusGroup.className = "form-group";
    const statusLabel = document.createElement("label");
    statusLabel.htmlFor = `solutionStatus-${report.id}`;
    statusLabel.textContent = "Report status";
    const statusSelect = document.createElement("select");
    statusSelect.id = statusLabel.htmlFor;
    statusSelect.name = "status";
    statusSelect.required = true;
    [
        ["In Progress", "In progress"],
        ["Resolved", "Resolved"]
    ].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        statusSelect.append(option);
    });
    statusGroup.append(statusLabel, statusSelect);

    const fileGroup = document.createElement("div");
    fileGroup.className = "form-group";
    const fileLabel = document.createElement("label");
    fileLabel.htmlFor = `solutionFile-${report.id}`;
    fileLabel.textContent = "Reference file";
    const fileInput = document.createElement("input");
    fileInput.id = fileLabel.htmlFor;
    fileInput.name = "reference_file";
    fileInput.type = "file";
    fileInput.accept = "image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/webm,audio/mp4,audio/ogg,application/pdf";
    fileInput.required = true;
    fileGroup.append(fileLabel, fileInput);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Save first response";
    const message = document.createElement("p");
    message.className = "form-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    form.append(responseGroup, actionGroup, statusGroup, fileGroup, submit, message);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitSolutionForm(form, message);
    });

    return form;
}

function createReportMessageForm(report) {
    const form = document.createElement("form");
    form.className = "report-message-form";
    form.dataset.reportId = report.id;

    const group = document.createElement("div");
    group.className = "form-group";
    const label = document.createElement("label");
    label.htmlFor = `reportReply-${report.id}`;
    label.textContent = "Reply";
    const input = document.createElement("textarea");
    input.id = label.htmlFor;
    input.name = "message";
    input.rows = 3;
    input.maxLength = 5000;
    input.required = true;
    input.placeholder = "Write an official reply to this report...";
    group.append(label, input);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Save reply to wall";
    const message = document.createElement("p");
    message.className = "form-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    form.append(group, submit, message);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitReportMessageForm(form, message);
    });
    return form;
}

async function submitReportMessageForm(form, message) {
    const reply = String(new FormData(form).get("message") || "").trim();
    if (!reply || reply.length > 5000) {
        setMessage(message, "Enter a reply using no more than 5,000 characters.", "error");
        return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setMessage(message, "Saving reply...", "");
    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token || !currentUserIsAdmin) {
            throw new Error("Only an administrator can reply to reports.");
        }
        await supabaseRequest("/rest/v1/report_messages", {
            method: "POST",
            token: session.access_token,
            headers: { Prefer: "return=representation" },
            body: {
                report_id: form.dataset.reportId,
                message: reply
            }
        });
        form.reset();
        setMessage(message, "Reply saved to the community wall.", "success");
        await loadSolutions();
    } catch (error) {
        console.error("Error saving report reply:", error);
        setMessage(message, error.message || "Unable to save the reply. Please try again.", "error");
        submit.disabled = false;
    }
}

async function submitSolutionForm(form, message) {
    const fileInput = form.elements.namedItem("reference_file");
    const file = fileInput.files[0];
    if (!file || file.size < 1 || file.size > maximumAttachmentSize ||
        !allowedAttachmentTypes.has(file.type)) {
        setMessage(message, "Choose a supported reference file no larger than 25 MB.", "error");
        return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setMessage(message, "Saving first response...", "");
    let referencePath = null;
    let accessToken = null;

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token || !currentUserIsAdmin) {
            throw new Error("Only an administrator can add report responses.");
        }
        accessToken = session.access_token;
        const reportId = form.dataset.reportId;
        const safeName = file.name.replace(/[^\w.-]/g, "_").slice(-100) || "reference";
        referencePath = `solutions/${reportId}/${crypto.randomUUID()}-${safeName}`;
        await supabaseRequest(`/storage/v1/object/report-attachments/${encodeStoragePath(referencePath)}`, {
            method: "POST",
            token: session.access_token,
            headers: {
                "Content-Type": file.type,
                "x-upsert": "false"
            },
            rawBody: file
        });

        const formData = new FormData(form);
        await supabaseRequest("/rest/v1/report_solutions", {
            method: "POST",
            token: session.access_token,
            body: {
                report_id: reportId,
                response_text: String(formData.get("response_text")).trim(),
                action_taken: String(formData.get("action_taken")).trim(),
                status: String(formData.get("status")),
                reference_file_path: referencePath,
                reference_file_name: file.name.slice(0, 255),
                reference_mime_type: file.type
            }
        });
        setMessage(message, "The first response and reference file have been saved.", "success");
        await loadSolutions();
    } catch (error) {
        if (referencePath && accessToken) {
            await removeSupabaseObjects([referencePath], accessToken);
        }
        console.error("Error saving first report response:", error);
        setMessage(message, error.message || "Unable to contact the server. Please try again.", "error");
        submit.disabled = false;
    }
}

function appendReportDetail(card, label, value) {
    const detail = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    detail.append(strong, document.createTextNode(value || ""));
    card.append(detail);
}

function createGpsIcon() {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 22s8-7.2 8-13a8 8 0 1 0-16 0c0 5.8 8 13 8 13Zm0-10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z");
    icon.append(path);
    return icon;
}

function createEmptyState(text) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = text;
    return empty;
}

async function loadAccountStatus() {
    const nav = document.querySelector(".site-header nav");
    if (!nav) {
        return false;
    }

    const oldStatus = nav.querySelector(".account-controls");
    if (oldStatus) {
        oldStatus.remove();
    }

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            currentUserIsAdmin = false;
            return false;
        }

        const user = await supabaseRequest("/auth/v1/user", { token: session.access_token });
        const userId = encodeURIComponent(user.id);
        const [profiles, adminRows] = await Promise.all([
            supabaseRequest(
                `/rest/v1/profiles?select=first_name,second_name,last_name&id=eq.${userId}`,
                { token: session.access_token }
            ),
            supabaseRequest(
                `/rest/v1/admin_users?select=user_id&user_id=eq.${userId}`,
                { token: session.access_token }
            )
        ]);
        const profile = profiles[0] || {};
        const profileName = [profile.first_name, profile.second_name, profile.last_name]
            .filter(Boolean)
            .join(" ");
        currentUserIsAdmin = Array.isArray(adminRows) && adminRows.length > 0;

        const controls = document.createElement("span");
        controls.className = "account-controls";
        const name = document.createElement("span");
        name.className = "account-status";
        name.textContent = profileName || user.email || "Signed in";
        const changeEmail = document.createElement("button");
        changeEmail.className = "secondary-button";
        changeEmail.type = "button";
        changeEmail.textContent = "Change sign-in email";
        changeEmail.addEventListener("click", () => changeAccountEmail(user.email || ""));
        const logout = document.createElement("button");
        logout.className = "sign-out-button";
        logout.type = "button";
        logout.textContent = "Sign out";
        logout.addEventListener("click", signOut);
        const deleteAccount = document.createElement("button");
        deleteAccount.className = "delete-account-button";
        deleteAccount.type = "button";
        deleteAccount.textContent = "Delete account";
        deleteAccount.addEventListener("click", deleteAccountInApp);
        controls.append(name, changeEmail, logout, deleteAccount);
        nav.append(controls);
        return currentUserIsAdmin;
    } catch (error) {
        console.error("Unable to check sign-in status:", error);
        currentUserIsAdmin = false;
        return false;
    }
}

async function changeAccountEmail(currentEmail) {
    const requestedEmail = window.prompt(
        "Enter the new sign-in email address. Supabase will send a confirmation email.",
        currentEmail
    );
    if (requestedEmail === null) {
        return;
    }

    const email = requestedEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        window.alert("Enter a valid email address.");
        return;
    }
    if (email === currentEmail.toLowerCase()) {
        window.alert("That is already the sign-in email for this account.");
        return;
    }

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Sign in again before changing your email.");
        }
        await supabaseRequest("/auth/v1/user", {
            method: "PUT",
            token: session.access_token,
            body: { email }
        });
        window.alert(
            `Supabase has started the email change for ${email}. Follow the confirmation instructions in your email before relying on the new address.`
        );
    } catch (error) {
        console.error("Error changing sign-in email:", error);
        window.alert(error.message || "Unable to change the sign-in email. Please try again.");
    }
}

async function signOut() {
    try {
        const session = await getSupabaseSession();
        if (session && session.access_token) {
            await supabaseRequest("/auth/v1/logout", {
                method: "POST",
                token: session.access_token
            });
        }
        localStorage.removeItem(supabaseSessionKey);
        sessionStorage.removeItem(supabaseSessionKey);
        window.location.href = "index.html";
    } catch (error) {
        console.error("Error signing out:", error);
        window.alert(error.message || "Unable to sign out. Please try again.");
    }
}

async function deleteAccountInApp() {
    if (!window.confirm("Permanently delete your account, reports, and attachments? This cannot be undone.")) {
        return;
    }

    try {
        const session = await getSupabaseSession();
        if (!session || !session.access_token) {
            throw new Error("Sign in again before deleting your account.");
        }
        await supabaseRequest("/functions/v1/delete-account", {
            method: "POST",
            token: session.access_token,
            body: {}
        });
        localStorage.removeItem(supabaseSessionKey);
        sessionStorage.removeItem(supabaseSessionKey);
        window.location.replace("index.html");
    } catch (error) {
        console.error("Error deleting account:", error);
        window.alert(error.message || "Unable to delete your account. Please try again.");
    }
}

function setMessage(element, text, kind) {
    element.textContent = text;
    element.className = `form-message${kind ? ` ${kind}` : ""}`;
}

function showAccountPanel(panel, openCard = false) {
    const registerPanel = document.getElementById("registerPanel");
    const loginPanel = document.getElementById("loginPanel");
    const accountCard = document.getElementById("accountCard");
    const showRegister = panel === "register";

    if (openCard) {
        accountCard.hidden = false;
        document.querySelector(".account-entry-actions").hidden = true;
        accountCard.scrollIntoView({ behavior: "smooth", block: "start" });
        accountCard.querySelector(showRegister ? "#registerFirstName" : "#loginIdNo").focus({ preventScroll: true });
    }

    registerPanel.hidden = !showRegister;
    loginPanel.hidden = showRegister;
}
