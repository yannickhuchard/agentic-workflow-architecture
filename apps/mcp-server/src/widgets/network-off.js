// A widget has no reason to reach the network: its data arrives through the
// host bridge. The views it is built from can load a record from an address
// when opened as pages (?data=, ?live=, ?run=, ?workflow=); inside a widget
// those paths are closed here, before any view code runs, whatever the host's
// Content-Security-Policy is.
(function () {
    'use strict';
    var refuse = function () { return Promise.reject(new Error('This view does not use the network.')); };
    var Closed = function () { throw new Error('This view does not use the network.'); };
    try { window.fetch = refuse; } catch (ignored) { /* already unavailable */ }
    ['XMLHttpRequest', 'EventSource', 'WebSocket'].forEach(function (name) { try { window[name] = Closed; } catch (ignored) { /* already unavailable */ } });
    try { if (navigator.sendBeacon) navigator.sendBeacon = function () { return false; }; } catch (ignored) { /* already unavailable */ }
})();
