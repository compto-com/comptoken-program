export function normalizeTime(time: Date): Date {
    const normalized = new Date(time);
    normalized.setUTCMilliseconds(0);
    normalized.setUTCSeconds(0);
    normalized.setUTCMinutes(0);
    normalized.setUTCHours(0);
    return normalized;
}

export function subtractDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
}
