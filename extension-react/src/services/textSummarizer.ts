// Text Summarization Service
// Handles summarization requests to LM Studio or Ollama

export interface SummaryResult {
    summary: string
    model: string
}

export interface SummarySettings {
    provider: 'lmstudio' | 'ollama'
    endpoint: string
    model: string
    minChars: number
    systemPrompt?: string
}

class TextSummarizer {
    private cache: Map<string, SummaryResult> = new Map()
    private readonly maxCacheSize = 30
    private readonly maxInputChars = 5000

    /**
     * Generate a cache key from text
     */
    generateKey(text: string): string {
        const normalized = text.trim().replace(/\s+/g, ' ')
        let hash = 0
        for (let i = 0; i < normalized.length; i++) {
            hash = ((hash << 5) - hash) + normalized.charCodeAt(i)
            hash |= 0 // Convert to 32bit integer
        }
        return `${normalized.length}:${Math.abs(hash)}`
    }

    /**
     * Build summarization payload based on provider
     */
    private buildPayload(text: string, settings: SummarySettings) {
        const systemPrompt = settings.systemPrompt ||
            "You write concise, user-friendly summaries for website text. Always start with between 1 and 5 emojis which best represent the text as a miniature sentiment analysis without the use of words. Only use emojis at very start then add a separator line ------ and follow up with the actual summary. Keep summary very short around 30 to 75 words max."

        const messages = [
            {
                role: "system",
                content: systemPrompt,
            },
            {
                role: "user",
                content: settings.systemPrompt ? text : `Here is the text: \n\n${text}`,
            },
        ]

        if (settings.provider === 'lmstudio') {
            return {
                model: settings.model,
                messages,
                temperature: 0.3,
                stream: false,
            }
        }

        if (settings.provider === 'ollama') {
            return {
                model: settings.model,
                stream: false,
                messages,
                options: { temperature: 0.3 },
            }
        }

        // Default: OpenAI compatible
        return {
            model: settings.model,
            temperature: 0.3,
            messages,
            reasoning: false,
        }
    }

    /**
     * Extract summary from API response
     */
    private extractSummary(data: any): string {
        if (!data) return ''

        // LM Studio / OpenAI Responses style
        if (Array.isArray(data.output_text) && data.output_text.length > 0) {
            const first = data.output_text[0]
            if (Array.isArray(first.content)) {
                const combined = first.content
                    .map((part: any) => typeof part.text === 'string' ? part.text : '')
                    .join('\n')
                if (combined.trim()) return this.postProcess(combined)
            }
            if (typeof first.text === 'string' && first.text.trim()) {
                return this.postProcess(first.text)
            }
        }

        if (Array.isArray(data.output) && data.output.length > 0) {
            const firstOut = data.output[0]
            if (Array.isArray(firstOut.content)) {
                const combined = firstOut.content
                    .map((part: any) => typeof part.text === 'string' ? part.text : '')
                    .join('\n')
                if (combined.trim()) return this.postProcess(combined)
            }
        }

        // Classic chat-completions (OpenAI, LM Studio /v1/chat/completions)
        if (Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0]
            if (choice.message && typeof choice.message.content === 'string') {
                return this.postProcess(choice.message.content)
            }
            if (Array.isArray(choice.message?.content)) {
                const concatenated = choice.message.content
                    .map((part: any) => part.text || '')
                    .join('\n')
                return this.postProcess(concatenated)
            }
            if (typeof choice.text === 'string') {
                return this.postProcess(choice.text)
            }
        }

        if (data.message && typeof data.message.content === 'string') {
            return this.postProcess(data.message.content)
        }

        if (typeof data.response === 'string') {
            return this.postProcess(data.response)
        }

        return ''
    }

    /**
     * Post-process summary to remove thinking tags
     */
    private postProcess(text: string): string {
        if (!text) return ''

        let cleaned = text

        // Remove <think>...</think> and <thinking>...</thinking> blocks
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '')
        cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')

        // Remove "Reasoning:" sections
        cleaned = cleaned.replace(/Reasoning:\s*[\s\S]*?(?:-----|\\n-{2,}\\n)/i, '')

        return cleaned.trim()
    }

    /**
     * Summarize text using configured provider
     */
    async summarize(text: string, settings: SummarySettings): Promise<SummaryResult> {
        // Truncate if too long
        const truncated = text.slice(0, this.maxInputChars)
        const key = this.generateKey(truncated)

        // Check cache
        const cached = this.cache.get(key)
        if (cached) {
            return cached
        }

        // Make API request
        const payload = this.buildPayload(truncated, settings)
        const response = await fetch(settings.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            throw new Error(`Summarization request failed (${response.status})`)
        }

        const data = await response.json()
        const summaryText = this.extractSummary(data)

        if (!summaryText) {
            throw new Error('Summarization provider returned an empty response')
        }

        const result: SummaryResult = {
            summary: summaryText.trim(),
            model: settings.model,
        }

        // Cache result
        this.cache.set(key, result)
        if (this.cache.size > this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value
            if (firstKey) {
                this.cache.delete(firstKey)
            }
        }

        return result
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear()
    }
}

export const textSummarizer = new TextSummarizer()
