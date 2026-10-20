const canvas = document.getElementById('mrlRGame');
let stream;
let config;
let sessions = [];
let recordingStartedAt = 0;
let activeUpload;
let initialization;

const recordingConfig = {
    width: 854,
    height: 480,
    fps: 30,
    bitrate: 900000,
    clipSeconds: 10
};

function mimeType() {
    return ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
}

function startRecorder() {
    const parts = [];
    const maxLifetimeMs = config.clipSeconds * 1000 * 2;
    const recorder = new MediaRecorder(stream, {
        mimeType: mimeType(),
        videoBitsPerSecond: config.bitrate
    });
    const session = {
        recorder,
        startedAt: Date.now()
    };

    session.clip = new Promise(resolve => { session.resolve = resolve; });
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    recorder.onstop = () => {
        if (session.maxLifetimeHandle) clearTimeout(session.maxLifetimeHandle);
        sessions = sessions.filter(item => item !== session);
        session.resolve(new Blob(parts, { type: 'video/webm' }));
        maintainRecorders();
    };
    session.maxLifetimeHandle = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
    }, maxLifetimeMs);

    sessions.push(session);
    recorder.start(1000);
    return session;
}

function activeSessions() {
    return sessions.filter(session => session.recorder.state === 'recording');
}

function maintainRecorders() {
    const windowMs = config.clipSeconds * 1000;
    const now = Date.now();

    activeSessions().forEach(session => {
        if (now - session.startedAt >= windowMs * 2) session.recorder.stop();
    });

    const target = now - recordingStartedAt >= windowMs ? 2 : 1;
    while (activeSessions().length < target) startRecorder();
}

async function currentClip() {
    const minimumAge = config.clipSeconds * 1000;
    const session = activeSessions()
        .filter(item => Date.now() - item.startedAt >= minimumAge)
        .sort((a, b) => a.startedAt - b.startedAt)[0];

    if (!session) {
        throw new Error(`buffer ainda acumulando: aguarde ${config.clipSeconds} segundos`);
    }

    const startedAt = session.startedAt;
    session.recorder.stop();
    const clip = await session.clip;
    maintainRecorders();

    if (!clip.size) throw new Error('video vazio');
    return {
        blob: clip,
        seconds: Math.round((Date.now() - startedAt) / 1000)
    };
}

async function clipWhenReady(signal) {
    try {
        return await currentClip();
    } catch (error) {
        if (!String(error.message).startsWith('buffer ainda acumulando')) throw error;

        await new Promise(resolve => setTimeout(resolve, 2000));
        if (signal.aborted) throw new DOMException('upload cancelado', 'AbortError');
        return clipWhenReady(signal);
    }
}

async function nui(name, body) {
    return fetch(`http://${GetParentResourceName()}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function getActiveUploadSession() {
    if (activeUpload) return activeUpload;

    activeUpload = {
        controller: new AbortController(),
        capturePromise: null,
        captured: null,
        captureError: null,
        requests: new Map(),
        timeoutHandle: null
    };

    return activeUpload;
}

async function uploadClipToWebhook(webhookValue, clip, signal) {
    if (!webhookValue) {
        throw new Error('webhook não informada');
    }

    const webhook = new URL(webhookValue);
    const filename = `replay_${Date.now()}.webm`;
    const form = new FormData();

    form.append('payload_json', JSON.stringify({
        attachments: [{ id: 0, filename }]
    }));
    form.append('files[0]', clip, filename);

    webhook.searchParams.set('wait', 'true');

    const response = await fetch(webhook.toString(), {
        method: 'POST',
        mode: 'cors',
        body: form,
        signal
    });
    const responseText = await response.text();

    if (!response.ok) {
        let detail = responseText.slice(0, 500);

        try {
            const discordError = JSON.parse(responseText);
            detail = discordError.message || detail;
        } catch {
        }

        throw new Error(`Discord HTTP ${response.status}: ${detail || 'sem detalhes'}`);
    }

    let discordMessage;

    try {
        discordMessage = JSON.parse(responseText);
    } catch {
        throw new Error(`Discord retornou resposta inválida: ${responseText.slice(0, 300)}`);
    }

    const url = discordMessage?.attachments?.[0]?.url;

    if (!url) {
        throw new Error('Discord não retornou a URL do vídeo');
    }

    return url;
}

async function processUploadRequest(session, request) {
    try {
        if (!session.capturePromise) {
            session.capturePromise = (async () => {
                await ensureRecording();
                return clipWhenReady(session.controller.signal);
            })().then(captured => {
                session.captured = captured;
                return captured;
            }).catch(error => {
                session.captureError = error;
                throw error;
            });
        }

        if (!session.timeoutHandle) {
            const timeoutMs = Number(request.timeoutMs) || 30000;
            session.timeoutHandle = setTimeout(() => {
                session.controller.abort();
            }, timeoutMs);
        }

        const captured = await session.capturePromise;
        const url = await uploadClipToWebhook(request.webhook, captured.blob, session.controller.signal);

        await nui('saved', {
            id: request.id,
            url,
            seconds: captured.seconds
        });
    } catch (error) {
        const reason = error.name === 'AbortError' ? 'upload cancelado ou expirado' : error.message;

        await nui('saved', {
            id: request.id,
            error: reason
        });
    } finally {
        session.requests.delete(request.id);

        if (session.requests.size === 0) {
            if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
            if (activeUpload === session) activeUpload = undefined;
        }
    }
}

function ensureRecording() {
    if (stream) return Promise.resolve();
    if (initialization) return initialization;

    initialization = (async () => {
        config = recordingConfig;
        const gameRender = await window.GameRenderReady;
        gameRender.renderToTarget(canvas, config.width, config.height);
        stream = canvas.captureStream(config.fps);
        recordingStartedAt = Date.now();
        startRecorder();
    })().catch(error => {
        stream = undefined;
        sessions = [];
        recordingStartedAt = 0;
        initialization = undefined;
        throw error;
    });

    return initialization;
}

ensureRecording().catch(() => { });

window.addEventListener('message', async event => {
    const message = event.data || {};
    if (message.action === 'cancel' && activeUpload?.requests?.has(message.id)) {
        activeUpload.controller.abort();
    }

    if (message.action === 'save') {
        const webhookValue = String(message.webhook || '').trim();
        const requestId = String(message.id || '').trim();

        if (!webhookValue || !requestId) {
            return;
        }

        const session = getActiveUploadSession();
        const request = {
            id: requestId,
            webhook: webhookValue,
            timeoutMs: Number(message.timeoutMs) || 30000
        };

        session.requests.set(request.id, request);
        processUploadRequest(session, request).catch(() => {});
    }
});
