import type { ChatAnswers } from "../chat/chat.answers";
import type { SlackInboundService } from "./slack.inbound.service";
import { SlackPressHandler } from "./slack.press-handler";

/**
 * The binding of Slack's button presses to the chat module's answering service (#538): made at
 * module init, in one direction, and nothing else.
 */

describe("the Slack press handler", () => {
  it("tells the inbound service where presses go, at module init and not before", () => {
    const answerPressesWith = jest.fn();
    const answers = { press: jest.fn() };
    const handler = new SlackPressHandler(
      { answerPressesWith } as unknown as SlackInboundService,
      answers as unknown as ChatAnswers,
    );

    expect(answerPressesWith).not.toHaveBeenCalled();

    handler.onModuleInit();

    expect(answerPressesWith).toHaveBeenCalledTimes(1);
    expect(answerPressesWith).toHaveBeenCalledWith(answers);
    // Registering is all it does: no press is made on anybody's behalf.
    expect(answers.press).not.toHaveBeenCalled();
  });
});
