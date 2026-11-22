// The widget side of the MCP Apps bridge, shared by every AWA widget.
//
// It speaks JSON-RPC over postMessage with the host (ui/initialize,
// ui/notifications/tool-result, ui/notifications/host-context-changed,
// tools/call, ui/request-display-mode, ui/update-model-context,
// ui/notifications/size-changed, ui/resource-teardown) and, where the host
// offers them instead, reads the window.openai globals of ChatGPT.
// It makes no network request of its own.
(function () {
    'use strict';
    var VERSION = '__AWA_WIDGET_VERSION__';
    window.AWA_HOST = {
        /**
         * @param options.name             the widget's name, sent to the host
         * @param options.onResult         receives a tool result: { structuredContent, _meta, content, isError }
         * @param options.onContext        receives the host context: theme, displayMode, maxHeight...
         * @param options.onError          receives an Error when no host answers
         * @param options.preferredHeight  (width, context) => the height the widget asks for when shown inline
         */
        connect: function (options) {
            var name = options.name, onResult = options.onResult, onContext = options.onContext || function () { }, onError = options.onError || function () { };
            var preferredHeight = options.preferredHeight || function () { return 560; };
            var nextId = 0, mcpConnected = false, disposed = false, globals = {}, lastMeta, lastOutput, resizeFrame, hostContext = {};
            var pending = new Map();
            var root = document.documentElement;
            function send(message) { message.jsonrpc = '2.0'; window.parent.postMessage(message, '*'); }
            function rpc(method, params) {
                return new Promise(function (resolve, reject) {
                    var id = ++nextId;
                    var timeout = setTimeout(function () { pending.delete(id); reject(new Error('The host did not answer. Reopen the view from the conversation.')); }, 15000);
                    pending.set(id, { resolve: resolve, reject: reject, timeout: timeout });
                    send({ id: id, method: method, params: params });
                });
            }
            function openai() { return window.openai; }
            function context(value) {
                if (!value || typeof value !== 'object') return;
                Object.assign(hostContext, value);
                var height = value.maxHeight !== undefined ? value.maxHeight : value.containerDimensions && value.containerDimensions.maxHeight;
                if (Number.isFinite(height) && height > 0) { hostContext.maxHeight = height; root.style.setProperty('--awa-host-max-height', height + 'px'); }
                var bottom = value.safeArea && value.safeArea.insets && value.safeArea.insets.bottom;
                if (Number.isFinite(bottom) && bottom >= 0) root.style.setProperty('--awa-safe-bottom', bottom + 'px');
                if (value.theme === 'light' || value.theme === 'dark') { root.dataset.awaTheme = value.theme; root.style.colorScheme = value.theme; }
                if (typeof value.displayMode === 'string') root.dataset.awaDisplay = value.displayMode;
                onContext(hostContext);
                resized();
            }
            function consumeGlobals(changed) {
                var api = openai(), supplied = {};
                ['toolOutput', 'toolResponseMetadata', 'maxHeight', 'safeArea', 'theme', 'displayMode'].forEach(function (key) {
                    if (api && api[key] !== undefined && api[key] !== null) supplied[key] = api[key];
                });
                globals = Object.assign({}, globals, supplied, changed || {});
                context(globals);
                var metadata = globals.toolResponseMetadata, output = globals.toolOutput;
                if ((metadata !== lastMeta || output !== lastOutput) && (metadata || output)) {
                    lastMeta = metadata; lastOutput = output;
                    onResult({ structuredContent: output, _meta: metadata });
                }
            }
            /** The height to ask the host for: the whole viewport in fullscreen, otherwise what the widget prefers, within the host's maximum */
            function wanted() {
                var max = Number.isFinite(hostContext.maxHeight) && hostContext.maxHeight > 0 ? hostContext.maxHeight : 900;
                if (hostContext.displayMode === 'fullscreen') return Math.max(240, Math.round(max));
                var width = window.innerWidth || root.clientWidth || 760;
                return Math.max(240, Math.min(Math.round(preferredHeight(width, hostContext)), Math.round(max)));
            }
            function resized() {
                if (resizeFrame || disposed) return;
                resizeFrame = requestAnimationFrame(function () {
                    resizeFrame = null;
                    var height = wanted();
                    root.style.setProperty('--awa-height', height + 'px');
                    if (mcpConnected) send({ method: 'ui/notifications/size-changed', params: { height: height } });
                    else if (openai() && typeof openai().notifyIntrinsicHeight === 'function') openai().notifyIntrinsicHeight(height);
                });
            }
            var api = {
                get connected() { return mcpConnected || !!(openai() && typeof openai().callTool === 'function'); },
                get context() { return hostContext; },
                request: function (method, params) {
                    if (mcpConnected) return rpc(method, params);
                    var o = openai();
                    if (method === 'tools/call' && o && typeof o.callTool === 'function') return Promise.resolve(o.callTool(params.name, params.arguments));
                    if (method === 'ui/request-display-mode' && o && typeof o.requestDisplayMode === 'function') return Promise.resolve(o.requestDisplayMode(params));
                    if (method === 'ui/update-model-context') return Promise.resolve({});
                    return Promise.reject(new Error('This host does not offer that command.'));
                },
                /** Ask for fullscreen, or go back inline when already there */
                toggleFullscreen: function () {
                    var mode = hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
                    return api.request('ui/request-display-mode', { mode: mode }).then(function (answer) { if (answer && typeof answer.mode === 'string') context({ displayMode: answer.mode }); return answer; });
                },
                /** Tell the model what the reader is looking at. Hosts without the method are left alone. */
                tell: function (structuredContent) {
                    if (!api.connected) return;
                    api.request('ui/update-model-context', { structuredContent: structuredContent }).catch(function () { });
                },
                resize: resized,
            };
            function globalEvent(event) { consumeGlobals(event.detail && event.detail.globals || {}); }
            function messageEvent(event) {
                if (event.source !== window.parent || !event.data || event.data.jsonrpc !== '2.0' || disposed) return;
                var message = event.data;
                if (message.method === 'ui/resource-teardown') {
                    disposed = true; cancelAnimationFrame(resizeFrame);
                    window.removeEventListener('message', messageEvent); window.removeEventListener('openai:set_globals', globalEvent); window.removeEventListener('resize', resized);
                    pending.forEach(function (item) { clearTimeout(item.timeout); item.reject(new Error('The view was closed.')); });
                    pending.clear(); send({ id: message.id, result: {} }); return;
                }
                if (message.id !== undefined && pending.has(message.id)) {
                    var item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timeout);
                    if (message.error) item.reject(new Error(String(message.error.message || 'The host refused the request.'))); else item.resolve(message.result);
                } else if (message.method === 'ui/notifications/tool-result') { onResult(message.params || {}); resized(); }
                else if (message.method === 'ui/notifications/host-context-changed') context(message.params);
            }
            window.addEventListener('message', messageEvent);
            window.addEventListener('openai:set_globals', globalEvent);
            window.addEventListener('resize', resized);
            consumeGlobals();
            if (window.parent !== window) {
                rpc('ui/initialize', { appInfo: { name: name, version: VERSION }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' })
                    .then(function (host) { if (disposed) return; mcpConnected = true; context(host && host.hostContext); send({ method: 'ui/notifications/initialized', params: {} }); resized(); })
                    .catch(function (error) { if (!disposed && !api.connected && !lastMeta && !lastOutput) onError(error); });
            } else onError(new Error('Preview only: open this view from a conversation in an MCP Apps host to load data.'));
            return api;
        },
    };
})();
