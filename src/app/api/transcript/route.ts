import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return new NextResponse('Missing ID', { status: 400 });
    }

    // Security: Prevent directory traversal
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(process.cwd(), 'src', 'data', 'transcripts', `${safeId}.txt`);

    try {
        if (!fs.existsSync(filePath)) {
            return new NextResponse('Transcript not found', { status: 404 });
        }

        const fileContents = fs.readFileSync(filePath, 'utf8');
        return new NextResponse(fileContents, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        });
    } catch (error) {
        console.error("Transcript read error:", error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
