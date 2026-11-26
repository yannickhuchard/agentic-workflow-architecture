/** A tool call or agent request that was refused or failed, with the error code that is journalled */
export class ToolError extends Error {
    constructor(message: string, public readonly code: string, extra: { status?: unknown; result?: unknown } = {}) {
        super(message);
        if (extra.status !== undefined) (this as { status?: unknown }).status = extra.status;
        if (extra.result !== undefined) (this as { result?: unknown }).result = extra.result;
    }
}

/** An address a tool or agent may reach: http or https, and nothing else (no file:, no data:) */
export function web_url(text: string): URL {
    let url: URL;
    try { url = new URL(text); } catch { throw new ToolError(`"${text}" is not a URL`, 'VALIDATION_ERROR'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ToolError(`Only http and https addresses can be reached, not ${url.protocol}`, 'VALIDATION_ERROR');
    return url;
}

/** Refuse a host the deployment does not allow (specification 17.4) */
export function check_host(host: string, allowed_hosts: string[] | undefined, what = 'calls'): void {
    if (allowed_hosts && !allowed_hosts.includes(host)) throw new ToolError(`This deployment does not allow ${what} to host "${host}"`, 'PERMISSION_DENIED');
}

/** Replace {{secret:NAME}} in a header value. A secret that is not configured fails the call. */
export function with_secrets(value: string, secrets: Record<string, string>): string {
    return value.replace(/\{\{secret:([\w-]+)\}\}/g, (_, key) => {
        if (!(key in secrets)) throw new ToolError(`Secret "${key}" is not configured`, 'VALIDATION_ERROR');
        return secrets[key];
    });
}
