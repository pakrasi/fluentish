/* The prompts of one conversation, filled from the public templates (services/prompts/conversation.js) with what he
   chose: level, mode, the topic or scenario, and in free chat the interests he typed. Nothing else about him. */
import { fill } from '../../services/prompts/index.js';
import { TEMPLATES, IDS } from '../../services/prompts/conversation.js';

/** @typedef {import('../../lang/types.js').ConversationRules} Conv */

/** Block 1: the same text for every session of a language (the cached prefix). @param {Conv} conv */
export const baseSystem = conv => fill(TEMPLATES[IDS.turn], { language: conv.language, example: conv.example || '' });

/**
 * Block 2: this session.
 * @param {Conv} conv
 * @param {{mode: 'free' | 'roleplay', level: string, partnerLevel: string, register: 'du' | 'sie', title: string, interests?: string[],
 *   scenario?: {role: string, setup: string, goal: string, opener: string} | null}} s
 */
export function sessionSystem(conv, s) {
  const address = conv.register[s.register] || s.register;
  if (s.mode === 'roleplay' && s.scenario) {
    return fill(TEMPLATES[IDS.roleplay], { level: s.level, partnerLevel: s.partnerLevel, address, role: s.scenario.role, setup: s.scenario.setup, goal: s.scenario.goal, opener: s.scenario.opener });
  }
  return fill(TEMPLATES[IDS.free], { level: s.level, partnerLevel: s.partnerLevel, address, topic: s.title, interests: (s.interests || []).join(', ') || 'none given' });
}

/** The mid-conversation note for Slower on or off. @param {boolean} slower @param {string} level the level to speak at now */
export const levelNote = (slower, level) => fill(TEMPLATES[slower ? IDS.slower : IDS.faster], { level });
/** The note near the session's limits. */
export const closingNote = () => TEMPLATES[IDS.closing];
/** The review's system prompt. @param {Conv} conv @param {string} level @param {string} partnerLevel */
export const feedbackSystem = (conv, level, partnerLevel) => fill(TEMPLATES[IDS.feedback], { language: conv.language, level, partnerLevel });
/** One tapped word for Claude. @param {Conv} conv @param {string} word @param {string} sentence */
export const glossPrompt = (conv, word, sentence) => fill(TEMPLATES[IDS.gloss], { language: conv.language, word, sentence });

export { IDS };
