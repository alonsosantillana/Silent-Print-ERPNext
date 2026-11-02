// Offline browser regression for the paired, independently loaded Desk indicators.
// Set PRINT_TEST_CHROMIUM to an existing headless Chromium executable; no installs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const silentRoot = path.resolve(__dirname, "..");
const restaurantRoot = process.env.PRINT_TEST_RESTAURANT_ROOT
    || path.resolve(silentRoot, "../restaurant_management");
const input = {
    jquery: fs.readFileSync(require.resolve("jquery", { paths: [path.resolve(silentRoot, "../frappe")] }), "utf8"),
    legacy: fs.readFileSync(path.join(silentRoot, "silent_print/public/js/silent_print_v15.js"), "utf8"),
    restaurant: fs.readFileSync(path.join(restaurantRoot,
        "restaurant_management/public/js/restaurant_print_indicator.js"), "utf8"),
};

async function browserSuite(input) {
    const results = [];
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const frames = [];
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

    function fixture({ version = 16, host = true, printUser = true, stations, master = false } = {}) {
        const frame = document.createElement("iframe");
        frame.style.cssText = "width:1000px;height:200px;display:block";
        document.body.append(frame);
        frames.push(frame);
        const w = frame.contentWindow;
        const d = w.document;
        d.open();
        d.write('<html><head><style>:root{--icon-stroke:#111;--icon-fill:transparent}'
            + '.icon{width:20px;height:20px;stroke:var(--icon-stroke);fill:none}'
            + '.page-head,.standard-items-section,.standard-items-band{min-height:35px;min-width:35px}'
            + '</style></head><body><svg style="display:none"><symbol id="icon-printer" viewBox="0 0 24 24">'
            + '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z"'
            + (version === 15 ? ' fill="var(--icon-stroke)" stroke="var(--icon-fill)"' : '')
            + '/></symbol></svg>'
            + '<div id="shell"></div><div id="a" class="page-container"></div>'
            + '<div id="b" class="page-container" style="display:none"></div></body></html>');
        d.close();
        w.eval(input.jquery);
        const $ = w.$;
        const calls = [], sockets = [], intervals = [], events = new Map();
        let responseStations = stations === undefined
            ? [{ active: true, bridge_state: "open", station_name: "Synthetic station" }] : stations;
        let failed = false;
        const header = '<div class="page-head"><div class="standard-items-section"></div></div>';
        const addHost = () => {
            if (version === 15) $("#shell").html('<a class="navbar-brand navbar-home">Home</a>');
            else { $("#a").html(header); $("#b").html(header); }
        };
        if (host) addHost();
        w.__ = text => text;
        w.sessionStorage.clear();
        w.sessionStorage.setItem("silent_print_tab_id", "offline-tab");
        w.localStorage.clear();
        w.setInterval = callback => { intervals.push(callback); return intervals.length; };
        w.clearInterval = () => {};
        // Reconnect timers are recorded, never run against a bridge.
        w.setTimeout = () => 1;
        w.clearTimeout = () => {};
        w.fetch = () => { throw new Error("Network is forbidden in this suite"); };
        w.XMLHttpRequest = class { constructor() { throw new Error("Network is forbidden"); } };
        w.WebSocket = class {
            static OPEN = 1;
            constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
            send() { throw new Error("No print payload may be sent"); }
            close() { this.readyState = 3; }
        };
        w.frappe = {
            container: { page: d.getElementById("a") },
            utils: { icon: () => '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-printer"></use></svg>' },
            provide(name) {
                let target = w;
                for (const part of name.split(".")) target = target[part] ||= {};
            },
            realtime: {
                on(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); },
            },
            show_alert() {},
            call(options) {
                calls.push(options.method);
                if (options.method.endsWith("get_station_bootstrap")) {
                    return failed ? Promise.reject(new Error("Synthetic failure"))
                        : Promise.resolve({ message: { stations: responseStations } });
                }
                if (options.method.endsWith("get_client_config")) {
                    const result = { message: { is_print_user: printUser, master_tab_id: master ? "offline-tab" : null } };
                    if (options.callback) options.callback(result);
                    return Promise.resolve(result);
                }
                if (options.method.endsWith("set_master_tab")) {
                    if (options.callback) options.callback({ message: { tab_id: "offline-tab" } });
                    return Promise.resolve({});
                }
                throw new Error("Unexpected RPC: " + options.method);
            },
        };
        const state = {
            w, d, $, calls, sockets, intervals, events, addHost,
            load(kind) { w.eval(input[kind]); },
            ready() { $(d).trigger("app_ready"); },
            navigate(id) {
                $(".page-container").hide();
                $("#" + id).show();
                w.frappe.container.page = d.getElementById(id);
                $(d).trigger("page-change");
            },
            refresh() { for (const callback of intervals) callback(); },
            stations(value) { responseStations = value; },
            fail(value) { failed = value; },
            emit(name, data) { for (const callback of events.get(name) || []) callback(data); },
        };
        return state;
    }

    async function run(name, body) {
        try { await body(); results.push({ name, passed: true }); }
        catch (error) { results.push({ name, passed: false, message: error.message }); }
        finally { for (const frame of frames.splice(0)) frame.remove(); }
    }

    for (const kind of ["legacy", "restaurant"]) {
        const id = kind === "legacy" ? "navbar-printer" : "restaurant-navbar-printer";
        for (const version of [15, 16]) {
            await run(kind + " mounts one visible SVG on v" + version, async () => {
                const s = fixture({ version }); s.load(kind); s.ready(); await flush();
                check(s.$("#" + id).length === 1, "missing or duplicate control");
                check(s.$("#" + id).is(":visible"), "control is hidden");
                check(s.$("#" + id + " svg").length === 1, "SVG is required without FontAwesome");
                if (version === 16) check(s.$("#a #" + id).length === 1, "must mount in active page");
                if (version === 15) {
                    // Timeless v15's printer paints fill=var(--icon-stroke),
                    // unlike Lucide v16's stroke-only glyph. Resolve those same
                    // path attributes inside the control's inherited CSS scope.
                    const svg = s.d.querySelector("#" + id + " svg");
                    const glyph = s.d.querySelector("#icon-printer path").cloneNode(true);
                    svg.append(glyph);
                    check(s.w.getComputedStyle(glyph).fill === s.w.getComputedStyle(s.d.getElementById(id)).color,
                        "classic v15 glyph did not inherit the status color");
                }
            });
        }
        await run(kind + " moves same node A/B/A without extra RPC or sockets", async () => {
            const s = fixture(); s.load(kind); s.ready(); await flush();
            const original = s.d.getElementById(id), calls = s.calls.length, sockets = s.sockets.length;
            for (const page of ["b", "a", "b", "a"]) { s.navigate(page); await flush(); }
            check(original && s.d.getElementById(id) === original, "node was lost or recreated");
            check(s.$("#a #" + id).length === 1 && s.$("#b #" + id).length === 0, "wrong page/clone");
            check(s.calls.length === calls && s.sockets.length === sockets, "navigation caused operational effects");
        });
        await run(kind + " recovers from missing startup host", async () => {
            const s = fixture({ host: false }); s.load(kind); s.ready(); await flush();
            const calls = s.calls.length; s.addHost(); s.navigate("a"); await flush();
            check(s.$("#a #" + id).is(":visible"), "late host did not receive control");
            check(s.calls.length === calls, "late mounting re-bootstrapped");
        });
        await run(kind + " supports sidebar fallback and later active header", async () => {
            const s = fixture({ host: false });
            s.$("#shell").html('<div class="body-sidebar"><div class="standard-items-band"></div></div>');
            s.load(kind); s.ready(); await flush();
            check(s.$(".standard-items-band #" + id).is(":visible"), "desktop fallback is missing");
            const node = s.d.getElementById(id); s.addHost(); s.navigate("a"); await flush();
            check(s.d.getElementById(id) === node && s.$("#a #" + id).length === 1, "fallback did not move");
        });
        await run(kind + " repeated app_ready does not duplicate initialization", async () => {
            const s = fixture(); s.load(kind); s.ready(); await flush();
            const calls = s.calls.length, intervals = s.intervals.length;
            s.ready(); s.ready(); s.navigate("b"); s.navigate("a"); await flush();
            check(s.calls.length === calls && s.intervals.length === intervals, "duplicate bootstrap/timer");
            check(s.$("#" + id).length === 1, "duplicate control");
        });
        await run(kind + " remains visible in a narrow header with the sidebar hidden", async () => {
            const s = fixture();
            s.w.frameElement.style.width = "360px";
            s.$("#shell").html('<div class="body-sidebar" style="display:none"><div class="standard-items-band"></div></div>');
            s.load(kind); s.ready(); await flush(); s.navigate("b"); await flush();
            check(s.$("#b #" + id).is(":visible"), "narrow header control is not visible");
            check(s.$(".body-sidebar #" + id).length === 0, "control was mounted in hidden sidebar");
        });
    }

    await run("missing station and non-print-user never create controls or sockets", async () => {
        const s = fixture({ printUser: false, stations: [] });
        s.load("legacy"); s.load("restaurant"); s.ready(); await flush();
        s.navigate("b"); s.refresh(); await flush();
        check(s.$("#navbar-printer,#restaurant-navbar-printer").length === 0, "unauthorized control");
        check(s.sockets.length === 0 && !s.w.frappe.setMasterTab, "unauthorized activation");
    });

    for (const order of [["legacy", "restaurant"], ["restaurant", "legacy"]]) {
        await run(order.join(" then ") + " preserves restaurant precedence and authorized legacy restoration", async () => {
            const s = fixture();
            for (const kind of order) { s.load(kind); s.ready(); await flush(); }
            check(s.$("#restaurant-navbar-printer").is(":visible"), "restaurant control missing");
            check(!s.$("#navbar-printer").is(":visible"), "legacy must be suppressed");
            s.navigate("b"); await flush();
            check(s.$("#b #restaurant-navbar-printer").is(":visible"), "restaurant lost on navigation");
            check(!s.$("#navbar-printer").is(":visible"), "legacy reappeared on navigation");
            s.stations([]); s.refresh(); await flush();
            check(!s.$("#restaurant-navbar-printer").length, "removed assignment still shown");
            check(s.$("#navbar-printer").is(":visible"), "authorized legacy not restored");
            check(s.sockets.length === 0, "mounting opened a bridge");
        });
    }

    await run("legacy click invokes master RPC exactly once after repeated navigation", async () => {
        const s = fixture(); s.load("legacy"); s.ready(); await flush();
        for (const id of ["b", "a", "b", "a"]) s.navigate(id);
        check(s.calls.filter(name => name.endsWith("set_master_tab")).length === 0, "implicit activation");
        s.$("#navbar-printer").triggerHandler("click");
        check(s.calls.filter(name => name.endsWith("set_master_tab")).length === 1, "click lost or duplicated");
        check(s.sockets.length === 0, "click must await the existing realtime flow");
        s.emit("update_master_tab", { tab_id: "offline-tab" });
        check(s.sockets.length === 1, "existing realtime activation changed");
        s.navigate("b"); s.navigate("a");
        check(s.sockets.length === 1, "navigation created another socket");
    });

    await run("restaurant link retains console route, new tab and cache clearing only", async () => {
        const s = fixture(); s.load("restaurant"); s.ready(); await flush();
        s.navigate("b"); s.w.localStorage.setItem("_page:restaurant-print-console", "stale");
        const icon = s.$("#restaurant-navbar-printer"), count = s.calls.length;
        check(icon.attr("href") === "/app/restaurant-print-console" && icon.attr("target") === "_blank", "route changed");
        icon.triggerHandler("click");
        check(s.w.localStorage.getItem("_page:restaurant-print-console") === null, "stale page cache retained");
        check(s.calls.length === count && s.sockets.length === 0, "link handler performed operational work");
    });

    await run("restaurant SVG preserves all status colors without FontAwesome", async () => {
        const s = fixture(); s.load("restaurant"); s.ready(); await flush();
        for (const [active, bridge_state, expected] of [
            [false, "open", "rgb(100, 116, 139)"], [true, "open", "rgb(22, 163, 74)"],
            [true, "idle", "rgb(217, 119, 6)"], [true, "connecting", "rgb(217, 119, 6)"],
            [true, "failed", "rgb(220, 38, 38)"], [true, "closed", "rgb(220, 38, 38)"],
        ]) {
            s.stations([{ active, bridge_state, station_name: "Synthetic station" }]); s.refresh(); await flush();
            const icon = s.d.getElementById("restaurant-navbar-printer"), svg = icon?.querySelector("svg");
            check(svg && s.w.getComputedStyle(svg).stroke === expected, "wrong rendered SVG stroke for " + bridge_state);
            check(icon.getAttribute("title") && icon.getAttribute("aria-label"), "missing accessible status");
        }
    });

    await run("legacy SVG preserves idle, connecting, open, failed and closed colors", async () => {
        const s = fixture({ master: true }); s.load("legacy"); s.ready(); await flush();
        const socket = s.sockets[0]; check(socket, "existing master auto-connect missing");
        const color = () => s.w.getComputedStyle(s.d.querySelector("#navbar-printer svg")).stroke;
        check(color() === "rgb(217, 119, 6)", "connecting must be amber");
        socket.readyState = 1; socket.onopen(); check(color() === "rgb(22, 163, 74)", "open must be green");
        socket.onerror(); check(color() === "rgb(220, 38, 38)", "failed must be red");
        socket.onclose(); check(color() === "rgb(220, 38, 38)", "closed must be red");
        s.navigate("b"); check(color() === "rgb(220, 38, 38)", "state lost on navigation");
    });

    await run("station read failure remains red on navigation and never restores legacy", async () => {
        const s = fixture(); s.load("legacy"); s.load("restaurant"); s.ready(); await flush();
        s.fail(true); s.refresh(); await flush(); s.navigate("b"); await flush();
        const icon = s.d.getElementById("restaurant-navbar-printer");
        check(icon && s.w.getComputedStyle(icon).color === "rgb(220, 38, 38)", "failure state was lost");
        check(!s.$("#navbar-printer").is(":visible") && !s.sockets.length, "failed read changed receiver authority");
    });
    return results;
}

const chromium = process.env.PRINT_TEST_CHROMIUM;
assert.ok(chromium && fs.existsSync(chromium), "Set PRINT_TEST_CHROMIUM to an existing headless Chromium binary");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "printer-indicator-offline-"));
let results;
try {
    const script = `(${browserSuite})(${JSON.stringify(input)}).then(results => {
        document.getElementById('results').textContent = JSON.stringify(results);
    }).catch(error => {document.getElementById('results').textContent = JSON.stringify([{name:'browser harness',passed:false,message:error.message}]);});`;
    const html = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" '
        + 'content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\'; frame-src \'self\' about:">'
        + '<pre id="results">PENDING</pre><script>' + script.replaceAll("</script", "<\\/script") + '</script>';
    const file = path.join(root, "fixture.html");
    fs.writeFileSync(file, html, { mode: 0o600 });
    const run = spawnSync(chromium, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run",
        "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions",
        "--host-resolver-rules=MAP * ~NOTFOUND", "--allow-file-access-from-files", "--dump-dom",
        "--virtual-time-budget=5000", "--user-data-dir=" + path.join(root, "profile"), "file://" + file],
        { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(run.status, 0, "Headless browser failed: " + String(run.error || run.stderr).slice(0, 400));
    const match = run.stdout.match(/<pre id="results">([^<]*)<\/pre>/);
    assert.ok(match && match[1] !== "PENDING", "Browser suite did not complete; inspect CSP/harness");
    results = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
} finally {
    fs.rmSync(root, { recursive: true, force: true }); // Only this run's mkdtemp directory.
}
assert.ok(results.length >= 22, "Expected all offline browser scenarios");
for (const result of results) test(result.name, () => assert.equal(result.passed, true, result.message));
