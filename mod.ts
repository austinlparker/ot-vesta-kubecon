import OpenAI from "jsr:@openai/openai";

export class ContentFilter {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
    });
  }

  async isAppropriate(text: string): Promise<{
    isAcceptable: boolean;
    filteredText?: string;
    reason?: string;
  }> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a content moderator for a public display board.
            Your job is to:
            1. Check if the content is appropriate for public display
            2. Filter out spam, advertisements, and inappropriate content
            3. Replace any bad words with appropriate alternatives
            4. Return the filtered text if acceptable, or explain why it should be rejected

            Respond in JSON format with properties:
            - isAcceptable: boolean
            - filteredText: string (if acceptable)
            - reason: string (if not acceptable)`,
          },
          {
            role: "user",
            content: text,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return {
        isAcceptable: result.isAcceptable,
        filteredText: result.filteredText,
        reason: result.reason,
      };
    } catch (error) {
      console.error("Content filtering error:", error);
      // Default to accepting the content if the filter fails
      return { isAcceptable: true, filteredText: text };
    }
  }
}
