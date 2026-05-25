import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface SseModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    chatId: number;
}

export function SseModal({ open, onOpenChange, chatId }: SseModalProps) {
    const [content, setContent] = React.useState('');
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const wsRef = React.useRef<WebSocket | null>(null);

    React.useEffect(() => {
        if (!open) return;

        setContent('');

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?chatId=${chatId}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[SseModal] Connected to WebSocket');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.rawSse) {
                    setContent(prev => prev + data.rawSse + '\n');
                }
            } catch {
                // Ignore malformed messages
            }
        };

        ws.onerror = () => {
            console.error('[SseModal] WebSocket error');
        };

        ws.onclose = () => {
            wsRef.current = null;
        };

        return () => {
            ws.close();
        };
    }, [open, chatId]);

    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
    }, [content]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>SSE Feed</DialogTitle>
                </DialogHeader>
                <div className="flex-1 min-h-0">
                    <textarea
                        ref={textareaRef}
                        value={content}
                        readOnly
                        className="w-full h-full bg-black/90 border border-border rounded-lg p-4 font-mono text-sm text-green-400/90 resize-none focus:outline-none focus:ring-0"
                        placeholder="SSE data will appear here..."
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
