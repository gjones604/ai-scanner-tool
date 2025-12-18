import { useState, useEffect, useCallback, useRef } from 'react'
import { imageScanner, type DetectionResult } from '../services/imageScanner'
import { type SummarySettings, textSummarizer } from '../services/textSummarizer'

export function useScanner(
    isActive: boolean,
    saveScannedImages: boolean = false,
    enableDeepAnalysis: boolean = false,
    deepAnalysisThreshold: number = 0.85,
    objectThresholds: Record<string, number> = {},
    summarySettings?: SummarySettings
) {
    const [hoveredImage, setHoveredImage] = useState<HTMLImageElement | null>(null)
    const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)
    const [isScanning, setIsScanning] = useState(false)
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
    const analyzingRef = useRef<Set<string>>(new Set())

    // Find image under cursor
    const findImageUnderCursor = useCallback((e: MouseEvent) => {
        // Use elementsFromPoint to find elements at the cursor even if covered by transparent overlays
        const elements = document.elementsFromPoint(e.clientX, e.clientY);

        for (const el of elements) {
            // Check if element is an image
            if (el instanceof HTMLImageElement) return el;

            // Optional: Check if we are hovering a container that wraps the image?
            // Usually finding the image directly is safer with elementsFromPoint.
            // But if the structure is specifically:
            // <div> <div overlay></div> <img /> </div>
            // The <img> will be in the elements list if it's visually at that point.
        }

        return null;
    }, [])

    const triggerDeepAnalysis = useCallback(async (result: DetectionResult) => {
        if (!result.image) return

        // Use per-object thresholds if available
        const targets = result.data.filter(d => {
            const threshold = objectThresholds[d.type] ?? deepAnalysisThreshold
            const isAnalyzable = ['person', 'dog', 'cat', 'car', 'truck', 'motorcycle'].includes(d.type)
            return isAnalyzable && d.confidence >= threshold && !d.analysis
        })
        if (targets.length === 0) return

        // Use a stable key
        const analyzeKey = `${result.image.substring(0, 50)}_${targets.length}`
        if (analyzingRef.current.has(analyzeKey)) return
        analyzingRef.current.add(analyzeKey)

        // Set initial loading state
        setDetectionResult(prev => {
            if (!prev) return prev
            return {
                ...prev,
                data: prev.data.map(d => {
                    const threshold = objectThresholds[d.type] ?? deepAnalysisThreshold
                    const isAnalyzable = ['person', 'dog', 'cat', 'car', 'truck', 'motorcycle'].includes(d.type)
                    return (isAnalyzable && d.confidence >= threshold && !d.analysis) ? { ...d, analysis: '...' } : d
                })
            }
        })

        try {
            await Promise.all(targets.map(async (target) => {
                // Step 1: Get Florence-2 Analysis (The "Vision" step)
                const visionResult = await imageScanner.analyzeBox(
                    result.image!,
                    target.x,
                    target.y,
                    target.width,
                    target.height,
                    target.type
                )

                if (!visionResult) return

                let finalAnalysis = visionResult

                // Step 2: If we have LLM settings, refine the output (The "Brain" step)
                if (summarySettings && visionResult && !visionResult.startsWith('Error')) {
                    try {
                        const targetQuestions: Record<string, string> = {
                            "person": "Who is the person in this image? Reply only with their name or alias if any or simply describe their appearance without identifying them.",
                            "dog": "What breed of dog is this?",
                            "cat": "Which breed of cat is this?",
                            "car": "Identify manufacturer and model of this car.",
                            "truck": "Identify manufacturer and model of this truck.",
                            "motorcycle": "Query vehicle: Identify manufacturer and model."
                        }

                        const query = targetQuestions[target.type] || `Analyze object: ${target.type}.`

                        const identifySystemPrompt =
                            "You are a futuristic bio-mechanical scanner OS. Your task is to provide immediate, high-certainty identification based on raw vision data. " +
                            "Output must be direct, cold, and factual. No greetings, no preamble, no fluff. " +
                            "If a name is present in the data, lead with it. If not, describe identifying features. " +
                            "Maximum length: 25 words."

                        const refinedResult = await textSummarizer.summarize(
                            `SOURCE VISION DATA: ${visionResult}\nUSER QUERY: ${query}`,
                            {
                                ...summarySettings,
                                systemPrompt: identifySystemPrompt,
                                minChars: 1
                            }
                        )

                        if (refinedResult?.summary) {
                            finalAnalysis = refinedResult.summary
                        }
                    } catch (err) {
                        console.error("LLM Refinement failed", err)
                        // Fall back to raw Florence result
                    }
                }

                setDetectionResult(prev => {
                    if (!prev) return prev
                    return {
                        ...prev,
                        data: prev.data.map(d =>
                            (d.x === target.x && d.y === target.y && d.type === target.type)
                                ? { ...d, analysis: finalAnalysis }
                                : d
                        )
                    }
                })
            }))
        } finally {
            setTimeout(() => {
                analyzingRef.current.delete(analyzeKey)
            }, 1000)
        }
    }, [deepAnalysisThreshold, objectThresholds, summarySettings])

    useEffect(() => {
        if (!isActive) {
            setHoveredImage(null)
            setDetectionResult(null)
            return
        }

        const handleMouseMove = async (e: MouseEvent) => {
            setMousePos({ x: e.clientX, y: e.clientY })

            const img = findImageUnderCursor(e)

            if (img !== hoveredImage) {
                setHoveredImage(img)
                if (img) {
                    // Check cache first
                    const src = imageScanner.getImageSourceKey(img)
                    const cached = imageScanner.getCachedDetection(src)
                    if (cached) {
                        setDetectionResult(cached)
                        setIsScanning(false)

                        // If cached has no analysis but deep analysis is now enabled, we might want to re-trigger?
                        // For now, let's just use cache as is.
                        const hasAnalysisPending = cached.data.some(d => {
                            const threshold = objectThresholds[d.type] ?? deepAnalysisThreshold
                            const isAnalyzable = ['person', 'dog', 'cat', 'car', 'truck', 'motorcycle'].includes(d.type)
                            return isAnalyzable && d.confidence >= threshold && !d.analysis
                        })

                        if (enableDeepAnalysis && hasAnalysisPending) {
                            triggerDeepAnalysis(cached)
                        }
                    } else {
                        setDetectionResult(null)
                        setIsScanning(true)
                        const res = await imageScanner.detectImage(img, saveScannedImages)
                        // Verify we are still hovering the same image
                        if (img === findImageUnderCursor(e)) {
                            setDetectionResult(res)
                            setIsScanning(false)

                            if (res && enableDeepAnalysis) {
                                triggerDeepAnalysis(res)
                            }
                        }
                    }
                } else {
                    setDetectionResult(null)
                    setIsScanning(false)
                }
            }
        }

        window.addEventListener('mousemove', handleMouseMove)
        return () => window.removeEventListener('mousemove', handleMouseMove)
    }, [isActive, hoveredImage, findImageUnderCursor])

    return {
        hoveredImage,
        detectionResult,
        isScanning,
        mousePos
    }
}
