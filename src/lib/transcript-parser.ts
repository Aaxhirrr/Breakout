export interface TranscriptLine {
    timestamp: number; // Seconds
    text: string;
    originalTime: string; // "MM:SS" format
}

export function parseTranscript(rawText: string): TranscriptLine[] {
    const lines = rawText.trim().split('\n');
    const transcript: TranscriptLine[] = [];

    for (let i = 0; i < lines.length; i += 2) {
        const timeStr = lines[i]?.trim();
        const text = lines[i + 1]?.trim();

        if (timeStr && text) {
            transcript.push({
                timestamp: parseTime(timeStr),
                text: text,
                originalTime: timeStr
            });
        }
    }

    return transcript;
}

export function getTranscriptHistory(transcript: TranscriptLine[], currentSeconds: number): string {
    // Get all lines that have happened UP TO the current timestamp
    const history = transcript.filter(line => line.timestamp <= currentSeconds);

    // Format as a readable script
    return history.map(line => `[${line.originalTime}] ${line.text}`).join('\n');
}

function parseTime(timeStr: string): number {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1]; // MM:SS
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
    }
    return 0;
}
