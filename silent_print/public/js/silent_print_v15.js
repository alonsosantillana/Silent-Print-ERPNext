(() => {
    frappe.provide("frappe.silent_print");

    const make_id = () => {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        const random = Math.random().toString(36).slice(2);
        return `sp-${Date.now().toString(36)}-${random}`;
    };

    const normalize_result = (payload) => {
        let result = payload;
        if (typeof payload === "string") {
            try {
                result = JSON.parse(payload);
            } catch (error) {
                return {
                    success: false,
                    job_id: null,
                    message: __("Invalid response from the print bridge"),
                    printer: null,
                };
            }
        }

        result = result || {};
        const has_modern_success = typeof result.success === "boolean";
        return {
            success: has_modern_success
                ? result.success
                : Number(result.status) === 0,
            job_id: result.id || result.job_id || null,
            message: result.message || "",
            printer: result.printer || result.printerName || result.printer_name || null,
        };
    };

    const bridge_error = (message, details = {}) => {
        const error = new Error(message);
        Object.assign(error, details);
        return error;
    };

    class WebSocketPrinter {
        constructor(options = {}) {
            this.options = Object.assign({
                url: "ws://127.0.0.1:12212/printer",
                max_queue: 20,
                max_reconnect_attempts: 5,
                reconnect_base_ms: 500,
                response_timeout_ms: 30000,
                keep_alive: false,
                on_state_change: () => {},
            }, options);
            this.socket = null;
            this.state = "idle";
            this.queue = [];
            this.pending = new Map();
            this.processed = new Set();
            this.reconnect_attempts = 0;
            this.reconnect_timer = null;
            this.manual_close = false;
        }

        _set_state(state) {
            this.state = state;
            this.options.on_state_change(state);
        }

        connect() {
            if (this.state === "open" || this.state === "connecting") return;
            this.manual_close = false;
            this._set_state("connecting");

            try {
                this.socket = new WebSocket(this.options.url);
            } catch (error) {
                this._set_state("failed");
                this._schedule_reconnect();
                return;
            }

            this.socket.onopen = () => {
                this.reconnect_attempts = 0;
                this._set_state("open");
                this._flush();
            };
            this.socket.onmessage = (event) => this._handle_message(event.data);
            this.socket.onerror = () => {
                if (this.state !== "closed") this._set_state("failed");
            };
            this.socket.onclose = () => {
                this.socket = null;
                this._reject_pending_as_ambiguous();
                if (!this.manual_close) {
                    this._set_state("closed");
                    this._schedule_reconnect();
                }
            };
        }

        reconnect() {
            this.reconnect_attempts = 0;
            this.manual_close = false;
            if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
            this.reconnect_timer = null;
            this.connect();
        }

        _schedule_reconnect() {
            if (this.manual_close || (!this.options.keep_alive && !this.queue.length)) return;
            if (this.reconnect_attempts >= this.options.max_reconnect_attempts) {
                this._set_state("failed");
                this._reject_unsent(__("Could not connect to WebApp Hardware Bridge"));
                return;
            }
            const delay = this.options.reconnect_base_ms * (2 ** this.reconnect_attempts);
            this.reconnect_attempts += 1;
            this.reconnect_timer = setTimeout(() => this.connect(), delay);
        }

        submit(data) {
            const payload = Object.assign({}, data);
            payload.id = payload.id || payload.job_id || make_id();
            payload.job_id = payload.id;
            payload.qty = Number(payload.qty || 1);

            if (!payload.type || (!payload.file_content && !payload.raw_content)) {
                return Promise.reject(bridge_error(
                    __("The print job is incomplete"),
                    { sent: false, job_id: payload.id }
                ));
            }
            if (this.processed.has(payload.id) || this.pending.has(payload.id)) {
                return Promise.reject(bridge_error(
                    __("The print job was already processed"),
                    { sent: false, duplicate: true, job_id: payload.id }
                ));
            }
            if (this.queue.length + this.pending.size >= this.options.max_queue) {
                return Promise.reject(bridge_error(
                    __("The local print queue is full"),
                    { sent: false, queue_full: true, job_id: payload.id }
                ));
            }

            const promise = new Promise((resolve, reject) => {
                this.queue.push({ payload, resolve, reject });
            });
            this.connect();
            if (this.state === "open") this._flush();
            return promise;
        }

        _flush() {
            while (
                this.queue.length &&
                this.socket &&
                this.socket.readyState === WebSocket.OPEN
            ) {
                const entry = this.queue.shift();
                try {
                    this.socket.send(JSON.stringify(entry.payload));
                    entry.sent_at = Date.now();
                } catch (error) {
                    entry.reject(bridge_error(
                        __("The print job could not be sent"),
                        { sent: false, job_id: entry.payload.id }
                    ));
                    continue;
                }

                entry.timer = setTimeout(() => {
                    if (!this.pending.has(entry.payload.id)) return;
                    this.pending.delete(entry.payload.id);
                    entry.reject(bridge_error(
                        __("The print result is ambiguous; verify the printer before retrying"),
                        { sent: true, ambiguous: true, job_id: entry.payload.id }
                    ));
                }, this.options.response_timeout_ms);
                this.pending.set(entry.payload.id, entry);
            }
        }

        _handle_message(raw_result) {
            const result = normalize_result(raw_result);
            if (!result.job_id || !this.pending.has(result.job_id)) return;

            const entry = this.pending.get(result.job_id);
            this.pending.delete(result.job_id);
            clearTimeout(entry.timer);
            this.processed.add(result.job_id);
            if (this.processed.size > 200) {
                this.processed.delete(this.processed.values().next().value);
            }

            if (result.success) {
                entry.resolve(result);
            } else {
                entry.reject(bridge_error(
                    result.message || __("The print bridge rejected the job"),
                    {
                        sent: true,
                        rejected: true,
                        job_id: result.job_id,
                        printer: result.printer,
                    }
                ));
            }
        }

        _reject_pending_as_ambiguous() {
            for (const [job_id, entry] of this.pending.entries()) {
                clearTimeout(entry.timer);
                entry.reject(bridge_error(
                    __("Connection closed after sending; verify the printer before retrying"),
                    {
                        sent: true,
                        ambiguous: true,
                        reason_code: "connection_closed",
                        elapsed_ms: entry.sent_at ? Date.now() - entry.sent_at : 0,
                        job_id,
                    }
                ));
            }
            this.pending.clear();
        }

        _reject_unsent(message) {
            while (this.queue.length) {
                const entry = this.queue.shift();
                entry.reject(bridge_error(message, {
                    sent: false,
                    job_id: entry.payload.id,
                }));
            }
        }

        close() {
            this.manual_close = true;
            if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
            this.reconnect_timer = null;
            this._reject_unsent(__("Print bridge connection closed"));
            this._reject_pending_as_ambiguous();
            if (this.socket) this.socket.close();
            this.socket = null;
            this._set_state("closed");
        }

        isConnected() {
            return this.state === "open";
        }

        getState() {
            return this.state;
        }
    }

    frappe.silent_print.WebSocketPrinter = WebSocketPrinter;
    frappe.silent_print.normalize_result = normalize_result;
    frappe.silent_print.make_id = make_id;

    const tab_storage_key = "silent_print_tab_id";
    const tab_id = window.sessionStorage.getItem(tab_storage_key) || make_id();
    window.sessionStorage.setItem(tab_storage_key, tab_id);
    window.tab_id = tab_id;

    const set_icon_state = (state) => {
        const colors = {
            open: "#16a34a",
            connecting: "#d97706",
            idle: "#64748b",
            closed: "#dc2626",
            failed: "#dc2626",
        };
        $("#navbar-printer").css("color", colors[state] || colors.idle);
    };

    const initialize_remote_receiver = (config) => {
        if (!config.is_print_user || frappe.silent_print.remote_initialized) return;
        frappe.silent_print.remote_initialized = true;

        $(".navbar-brand.navbar-home").before(
            '<div id="navbar-printer" class="navbar-center ellipsis" '
            + 'style="color:#64748b;margin-right:8px" title="Silent Print">'
            + '<i class="fa fa-print"></i></div>'
        );

        const printer = new WebSocketPrinter({
            keep_alive: true,
            on_state_change: set_icon_state,
        });
        frappe.silent_print.remote_printer = printer;

        frappe.setMasterTab = () => frappe.call({
            method: "silent_print.utils.print_format.set_master_tab",
            type: "POST",
            args: { tab_id },
            callback: () => {
                set_icon_state(printer.getState());
                frappe.show_alert({
                    message: __("This tab is now the print station"),
                    indicator: "green",
                });
            },
        });
        $("#navbar-printer").on("click", () => frappe.setMasterTab());

        frappe.realtime.on("update_master_tab", (data) => {
            if (data.tab_id === tab_id) {
                printer.reconnect();
            } else {
                printer.close();
            }
        });

        frappe.realtime.on("print-silently", (data) => {
            if (data.tab_id !== tab_id) return;
            printer.submit({
                type: data.print_type,
                url: "file.pdf",
                file_content: data.pdf,
                id: data.job_id || data.id,
                qty: data.qty || 1,
            }).then(() => {
                frappe.show_alert({
                    message: __("Print job accepted by the bridge"),
                    indicator: "green",
                });
            }).catch((error) => {
                frappe.show_alert({
                    message: error.message,
                    indicator: error.ambiguous ? "orange" : "red",
                }, 10);
            });
        });

        if (config.master_tab_id === tab_id) printer.connect();
        set_icon_state(config.master_tab_id === tab_id ? "connecting" : "idle");
    };

    $(document).on("app_ready", () => {
        if (frappe.silent_print.bootstrap_requested) return;
        frappe.silent_print.bootstrap_requested = true;
        frappe.call({
            method: "silent_print.utils.print_format.get_client_config",
            type: "GET",
            callback: (response) => initialize_remote_receiver(response.message || {}),
        });
    });
})();
