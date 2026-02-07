/**
 * Utility functions for handling ISO 8601 durations and time tracking for VSM
 */

/**
 * Formats a duration in milliseconds as an ISO 8601 duration string (PTnHnMnS)
 */
export function format_iso_duration(ms: number): string {
    if (ms < 0) ms = 0;

    const seconds = (ms / 1000) % 60;
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    let result = 'P';
    if (days > 0) result += `${days}D`;

    result += 'T';
    if (hours > 0) result += `${hours}H`;
    if (minutes > 0) result += `${minutes}M`;
    if (seconds > 0 || result === 'PT') {
        result += `${seconds.toFixed(1)}S`;
    }

    return result;
}

/**
 * Calculates the difference between two dates as an ISO 8601 duration string
 */
export function calculate_duration(start: Date, end: Date = new Date()): string {
    return format_iso_duration(end.getTime() - start.getTime());
}

/**
 * Calculates the difference between two dates in milliseconds
 */
export function calculate_ms(start: Date, end: Date = new Date()): number {
    return end.getTime() - start.getTime();
}
