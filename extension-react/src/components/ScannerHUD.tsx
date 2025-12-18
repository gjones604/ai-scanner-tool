import React, { useState, useEffect } from 'react'
import { Brain, X, Target } from 'lucide-react'

import { useScanner } from '../hooks/useScanner'
import { useTextSummarization } from '../hooks/useTextSummarization'
import SummaryOverlay from './SummaryOverlay'
import type { SummarySettings } from '../services/textSummarizer'

interface ScannerHUDProps {
    shadowRoot?: ShadowRoot
}

interface Settings {
    triggerInput: string
    detectionEndpoint: string
    showCrawlingLines: boolean
    enableSummarization: boolean
    summarizationProvider: 'lmstudio' | 'ollama'
    summarizationEndpoint: string
    summarizationModel: string
    minSummaryChars: number
    toggleActivation: boolean
    saveScannedImages: boolean
    enableDeepAnalysis: boolean
    deepAnalysisThreshold: number
    objectThresholds: Record<string, number>
}

const DEFAULT_SETTINGS: Settings = {
    triggerInput: 'keyboard:Shift',
    detectionEndpoint: 'http://localhost:8001/api/detect-base64',
    showCrawlingLines: true,
    enableSummarization: true,
    summarizationProvider: 'lmstudio',
    summarizationEndpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    summarizationModel: 'ibm/granite-4-h-tiny',
    minSummaryChars: 40,
    toggleActivation: false,
    saveScannedImages: false,
    enableDeepAnalysis: false,
    deepAnalysisThreshold: 0.85,
    objectThresholds: {
        "person": 0.85,
        "car": 0.50,
        "truck": 0.50,
        "motorcycle": 0.50,
        "dog": 0.50,
        "cat": 0.50,
        "bird": 0.50,
        "text": 0.50
    }
}

const ScannerHUD: React.FC<ScannerHUDProps> = () => {
    const [isActive, setIsActive] = useState(false)
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
    const summarySettings: SummarySettings = {
        provider: settings.summarizationProvider,
        endpoint: settings.summarizationEndpoint,
        model: settings.summarizationModel,
        minChars: settings.minSummaryChars,
    }

    const { hoveredImage, detectionResult, isScanning, mousePos } = useScanner(
        isActive,
        settings.saveScannedImages,
        settings.enableDeepAnalysis,
        settings.deepAnalysisThreshold,
        settings.objectThresholds,
        summarySettings
    )

    const {
        selection,
        summaryResult,
        isSummarizing,
        error: summaryError,
    } = useTextSummarization(isActive && settings.enableSummarization, summarySettings)

    // Load settings from chrome storage and listen for changes
    useEffect(() => {
        const loadSettings = (callback?: () => void) => {
            if (chrome?.storage?.sync) {
                chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (result) => {
                    const mergedSettings = { ...DEFAULT_SETTINGS, ...result }
                    if (typeof mergedSettings.minSummaryChars !== 'number') {
                        mergedSettings.minSummaryChars = DEFAULT_SETTINGS.minSummaryChars
                    }
                    setSettings(mergedSettings as Settings)
                    callback?.()
                })
            }
        }

        loadSettings()

        // Listen for storage changes (when user updates settings from popup)
        // Re-load ALL settings to avoid stale reference issues
        const handleStorageChange = () => {
            loadSettings()
        }

        chrome?.storage?.onChanged?.addListener(handleStorageChange)
        return () => {
            chrome?.storage?.onChanged?.removeListener(handleStorageChange)
        }
    }, [])

    // Use ref to avoid stale closure issues in event handlers
    const settingsRef = React.useRef(settings)
    React.useEffect(() => {
        settingsRef.current = settings
    }, [settings])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return

            const currentSettings = settingsRef.current
            // Parse trigger from settings
            const [inputType, inputValue] = currentSettings.triggerInput.split(':')

            if (inputType === 'keyboard' && (e.key === inputValue || e.code === inputValue)) {
                if (currentSettings.toggleActivation) {
                    setIsActive(prev => !prev)
                } else {
                    setIsActive(true)
                }
                e.preventDefault()
                e.stopPropagation()
            }

            if (e.key === 'Escape') {
                setIsActive(false)
            }
        }

        const handleKeyUp = (e: KeyboardEvent) => {
            const currentSettings = settingsRef.current
            // Only deactivate on key up if NOT in toggle mode
            if (currentSettings.toggleActivation) return

            const [inputType, inputValue] = currentSettings.triggerInput.split(':')

            if (inputType === 'keyboard' && (e.key === inputValue || e.code === inputValue)) {
                setIsActive(false)
                e.preventDefault()
                e.stopPropagation()
            }
        }

        const handleMouseDown = (e: MouseEvent) => {
            const currentSettings = settingsRef.current
            const [inputType, inputValue] = currentSettings.triggerInput.split(':')

            if (inputType === 'mouse' && e.button === parseInt(inputValue, 10)) {
                if (currentSettings.toggleActivation) {
                    setIsActive(prev => !prev)
                } else {
                    setIsActive(true)
                }
                e.preventDefault()
                e.stopPropagation()
            }
        }

        const handleMouseUp = (e: MouseEvent) => {
            const currentSettings = settingsRef.current
            // Only deactivate on mouse up if NOT in toggle mode
            if (currentSettings.toggleActivation) return

            const [inputType, inputValue] = currentSettings.triggerInput.split(':')

            if (inputType === 'mouse' && e.button === parseInt(inputValue, 10)) {
                setIsActive(false)
                e.preventDefault()
                e.stopPropagation()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        window.addEventListener('mousedown', handleMouseDown)
        window.addEventListener('mouseup', handleMouseUp)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
            window.removeEventListener('mousedown', handleMouseDown)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, []) // Empty deps - handlers use ref for fresh settings

    if (!isActive) return null

    return (
        <div id="ai-scanner-hud-container" className="fixed inset-0 pointer-events-none z-[99999] font-mono text-cyan-400">
            {/* Vignette / CRT Effect */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.25)_100%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay" />
            <div className="absolute inset-0 border-[20px] border-cyan-900/20 box-border pointer-events-none" />

            {/* Top HUD Bar */}
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/80 to-transparent flex items-center px-8 border-b border-cyan-500/30 backdrop-blur-sm pointer-events-auto">
                <div className="flex items-center space-x-4">
                    <Brain className="w-6 h-6 animate-pulse" />
                    <span className="text-xl font-bold tracking-widest text-shadow-cyber">AI SCANNER: ONLINE</span>
                </div>
                <div className="flex-1" />
                <div className="flex items-center space-x-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${settings.enableSummarization ? 'bg-cyan-400' : 'bg-gray-600'}`} />
                        <span>TEXT</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${settings.detectionEndpoint ? 'bg-cyan-400' : 'bg-gray-600'}`} />
                        <span>IMAGE</span>
                    </div>
                    <button onClick={() => setIsActive(false)} className="p-2 hover:bg-red-500/20 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Square Scanner Reticle - follows mouse, snaps to image when hovering */}
            {(() => {
                // Calculate reticle position and size
                const imageRect = hoveredImage?.getBoundingClientRect()
                const isOnImage = !!(hoveredImage && imageRect)

                // Default: 50x50 centered on mouse
                // When on image: match image bounds
                const reticleLeft = isOnImage ? imageRect!.left : mousePos.x - 25
                const reticleTop = isOnImage ? imageRect!.top : mousePos.y - 25
                const reticleWidth = isOnImage ? imageRect!.width : 50
                const reticleHeight = isOnImage ? imageRect!.height : 50

                return (
                    <div
                        id="scanner-reticle"
                        className="fixed pointer-events-none z-[99998]"
                        style={{
                            left: reticleLeft,
                            top: reticleTop,
                            width: reticleWidth,
                            height: reticleHeight,
                            transition: isOnImage ? 'all 0.15s ease-out' : 'none',
                        }}
                    >
                        {/* Main border */}
                        <div
                            className="absolute inset-0 border-2 transition-colors duration-200"
                            style={{
                                borderColor: isScanning ? '#facc15' : '#22d3ee',
                                boxShadow: isScanning
                                    ? '0 0 10px rgba(250, 204, 21, 0.5), inset 0 0 10px rgba(250, 204, 21, 0.1)'
                                    : '0 0 10px rgba(34, 211, 238, 0.5), inset 0 0 10px rgba(34, 211, 238, 0.1)'
                            }}
                        />

                        {/* Corner accents - top left */}
                        <div className="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2" style={{ borderColor: '#67e8f9' }} />
                        {/* Corner accents - top right */}
                        <div className="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2" style={{ borderColor: '#67e8f9' }} />
                        {/* Corner accents - bottom left */}
                        <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2" style={{ borderColor: '#67e8f9' }} />
                        {/* Corner accents - bottom right */}
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2" style={{ borderColor: '#67e8f9' }} />

                        {/* Center crosshair - only show when not on image */}
                        {!isOnImage && (
                            <>
                                <div className="absolute top-1/2 left-1/2 w-[2px] h-4 transform -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: '#22d3ee' }} />
                                <div className="absolute top-1/2 left-1/2 w-4 h-[2px] transform -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: '#22d3ee' }} />
                            </>
                        )}

                        {/* Scanning spinner overlay */}
                        {isScanning && isOnImage && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div
                                    className="w-12 h-12 rounded-full animate-spin"
                                    style={{
                                        border: '3px solid #facc15',
                                        borderTopColor: 'transparent',
                                        borderRightColor: 'transparent',
                                    }}
                                />
                            </div>
                        )}

                        {/* Status label */}
                        <div className="absolute -bottom-7 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                            <div
                                className="text-[10px] uppercase tracking-widest px-2 py-1 rounded"
                                style={{
                                    color: '#22d3ee',
                                    backgroundColor: 'rgba(0,0,0,0.8)',
                                    border: '1px solid rgba(34, 211, 238, 0.3)'
                                }}
                            >
                                {isScanning ? '⟳ SCANNING...' : selection ? '📝 TEXT MODE' : isOnImage ? '🖼️ IMAGE DETECTED' : '○ SEARCHING'}
                            </div>
                        </div>

                        {/* Detection results overlaid on the image */}
                        {isOnImage && detectionResult?.data.map((det, idx) => {
                            const x = (det.x / 100) * reticleWidth
                            const y = (det.y / 100) * reticleHeight
                            const w = (det.width / 100) * reticleWidth
                            const h = (det.height / 100) * reticleHeight

                            return (
                                <div
                                    key={idx}
                                    className="absolute"
                                    style={{
                                        left: x,
                                        top: y,
                                        width: w,
                                        height: h,
                                        border: '2px solid #4ade80',
                                        backgroundColor: 'rgba(74, 222, 128, 0.15)',
                                    }}
                                >
                                    {/* Small type tag for the box itself */}
                                    <div
                                        className="absolute -top-5 left-0 text-[10px] px-2 py-0.5 uppercase tracking-wider flex items-center gap-1 whitespace-nowrap"
                                        style={{
                                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                            color: '#4ade80',
                                            border: '1px solid rgba(74, 222, 128, 0.4)'
                                        }}
                                    >
                                        <Target className="w-2.5 h-2.5" />
                                        {det.type}
                                    </div>
                                </div>
                            )
                        })}

                        {/* Deep Analysis Sidebar Labels with Connector Lines */}
                        {isOnImage && detectionResult?.data && (
                            <div className="absolute left-full top-0 ml-12 flex flex-col gap-6 w-64 pointer-events-auto">
                                <svg className="absolute right-full top-0 h-full w-12 overflow-visible pointer-events-none">
                                    {detectionResult.data.map((det, idx) => {
                                        if (!det.analysis) return null;
                                        const boxCenterY = ((det.y + det.height / 2) / 100) * reticleHeight;
                                        // Simple heuristic for label Y stacking
                                        // In a real app we'd measure DOM elements, but for brief labels this works well
                                        const labelY = idx * 90 + 30;

                                        const startX = -((100 - (det.x + det.width)) / 100) * reticleWidth;
                                        const startY = boxCenterY;

                                        return (
                                            <g key={`line-${idx}`}>
                                                <path
                                                    d={`M ${startX} ${startY} L -20 ${startY} L 0 ${labelY}`}
                                                    stroke="#22d3ee"
                                                    strokeWidth="1"
                                                    fill="none"
                                                    strokeDasharray="4 2"
                                                    className="opacity-50"
                                                />
                                                <circle cx={startX} cy={startY} r="2" fill="#22d3ee" />
                                                <circle cx="0" cy={labelY} r="2" fill="#22d3ee" />
                                            </g>
                                        );
                                    })}
                                </svg>

                                {detectionResult.data.map((det, idx) => {
                                    if (!det.analysis) return null;
                                    return (
                                        <div
                                            key={`label-${idx}`}
                                            className="relative flex flex-col gap-1 p-3 transform transition-all duration-300 animate-in slide-in-from-left-2"
                                            style={{
                                                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                                color: '#22d3ee',
                                                border: '1px solid rgba(34, 211, 238, 0.4)',
                                                borderLeft: '4px solid #22d3ee',
                                                backdropFilter: 'blur(8px)',
                                                boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
                                            }}
                                        >
                                            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1 mb-1 text-[10px] uppercase font-bold tracking-tighter">
                                                <div className="flex items-center gap-2">
                                                    <Brain className="w-3 h-3" />
                                                    <span>{det.type} IDENTITY</span>
                                                </div>
                                                <span className="opacity-60">CONF: {(det.confidence * 100).toFixed(0)}%</span>
                                            </div>

                                            <div className="normal-case italic text-cyan-50 text-[11px] leading-relaxed">
                                                {det.analysis === '...' ? (
                                                    <div className="flex flex-col gap-2 py-1">
                                                        <span className="flex items-center gap-2 text-[8px] uppercase tracking-tighter opacity-70">
                                                            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                                                            INITIALIZING DEEP SCAN...
                                                        </span>
                                                        <div className="h-1 w-full bg-cyan-950 rounded-full overflow-hidden">
                                                            <div className="h-full bg-cyan-400 animate-progress-indefinite" />
                                                        </div>
                                                    </div>
                                                ) : det.analysis}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )
            })()}

            {/* Text Summary Overlay */}
            {settings.enableSummarization && (
                <SummaryOverlay
                    selection={selection}
                    summaryResult={summaryResult}
                    isSummarizing={isSummarizing}
                    error={summaryError}
                    mousePos={mousePos}
                    provider={settings.summarizationProvider}
                />
            )}

            {/* Bottom Status Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-black/80 flex items-center justify-between px-8 text-xs border-t border-cyan-900/50">
                <div className="font-mono">
                    COORDS: {mousePos.x.toFixed(0)} : {mousePos.y.toFixed(0)} | REF: {hoveredImage ? 'LOCKED' : selection ? 'TEXT' : 'SEARCHING'}
                </div>
                <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span>SYSTEM NORMAL</span>
                </div>
            </div>
        </div>
    )
}

export default ScannerHUD
