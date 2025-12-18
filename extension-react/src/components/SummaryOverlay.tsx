import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Loader2, AlertCircle } from 'lucide-react'
import type { TextSelection } from '../hooks/useTextSummarization'
import type { SummaryResult } from '../services/textSummarizer'

interface SummaryOverlayProps {
    selection: TextSelection | null
    summaryResult: SummaryResult | null
    isSummarizing: boolean
    error: string
    mousePos: { x: number; y: number }
}

const SummaryOverlay: React.FC<SummaryOverlayProps> = ({
    selection,
    summaryResult,
    isSummarizing,
    error,
    mousePos,
}) => {
    const [position, setPosition] = useState({ left: 0, top: 0 })

    useEffect(() => {
        if (!selection) return

        let left = mousePos.x + 16
        let top = mousePos.y - 20

        // If we have a selection rect, position relative to it
        if (selection.rect) {
            left = selection.rect.left + selection.rect.width + 16
            top = selection.rect.top - 10
        }

        // Clamp to viewport
        const maxLeft = window.innerWidth - 380
        const maxTop = window.innerHeight - 200

        const clampedLeft = Math.max(8, Math.min(left, maxLeft))
        const clampedTop = Math.max(8, Math.min(top, maxTop))

        setPosition({ left: clampedLeft, top: clampedTop })
    }, [selection, mousePos])

    if (!selection) return null

    const isFullPage = selection.rawText.length > 5000

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="fixed pointer-events-none z-[100000]"
                style={{
                    left: `${position.left}px`,
                    top: `${position.top}px`,
                }}
            >
                <div className="relative">
                    {/* Cyberpunk glow effect */}
                    <div className="absolute inset-0 bg-cyan-500/20 blur-xl rounded-lg" />

                    {/* Main container */}
                    <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-md border border-cyan-500/40 rounded-lg shadow-2xl max-w-[360px] min-w-[260px]">
                        {/* Animated border effect */}
                        <div className="absolute inset-0 rounded-lg overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 via-cyan-500/30 to-cyan-500/0 animate-pulse" />
                        </div>

                        {/* Content */}
                        <div className="relative p-4 space-y-3">
                            {/* Header */}
                            <div className="flex items-center gap-2 border-b border-cyan-500/30 pb-2">
                                <FileText className="w-4 h-4 text-cyan-400" />
                                <span className="text-sm font-semibold text-cyan-300 uppercase tracking-wider">
                                    {isFullPage ? 'Full Page Summary' : 'Text Summary'}
                                </span>
                            </div>

                            {/* Preview */}
                            {selection.preview && (
                                <div className="text-xs text-slate-400 leading-relaxed line-clamp-3 font-mono">
                                    {selection.preview}
                                </div>
                            )}

                            {/* Summary content - scrollable */}
                            <div className="min-h-[60px] max-h-[200px] overflow-y-auto pointer-events-auto scrollbar-thin scrollbar-thumb-cyan-500/50 scrollbar-track-transparent">
                                {error ? (
                                    <div className="flex items-start gap-2 text-red-400 text-sm">
                                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                ) : summaryResult?.summary ? (
                                    <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                                        {summaryResult.summary}
                                    </div>
                                ) : isSummarizing ? (
                                    <div className="flex items-center gap-2 text-cyan-300 text-sm">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="animate-pulse">Analyzing patterns…</span>
                                    </div>
                                ) : (
                                    <div className="text-sm text-slate-400 italic">
                                        Highlight text and hold the trigger key to summarize.
                                    </div>
                                )}
                            </div>

                            {/* Footer metadata */}
                            {summaryResult?.model && (
                                <div className="flex items-center gap-2 pt-2 border-t border-cyan-500/20">
                                    <div className="flex-1 text-[10px] uppercase tracking-widest text-slate-500 font-mono">
                                        Local · {summaryResult.model}
                                    </div>
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                                </div>
                            )}

                            {/* Cyberpunk corner accents */}
                            <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
                            <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-cyan-400" />
                            <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-cyan-400" />
                            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />
                        </div>

                        {/* Scan line effect */}
                        <motion.div
                            className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50"
                            animate={{
                                top: ['0%', '100%'],
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: 'linear',
                            }}
                        />
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

export default SummaryOverlay
