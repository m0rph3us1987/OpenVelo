import { Router } from 'express';
import {
  getChatSession,
  getDomainsByChatId,
  getDomainQuestionsByChatId,
  saveDomainAnswer,
  getDomainAnswersByChatId,
  insertChatMessage,
} from '@/lib/db';
import { transitionTo } from '@/lib/workflow';
import { requireProjectAccess } from '../middleware/auth';

export const domainsRouter = Router();

domainsRouter.get('/', requireProjectAccess, async (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  const domains = getDomainsByChatId(Number(chatId));
  const questions = getDomainQuestionsByChatId(Number(chatId));
  const answers = getDomainAnswersByChatId(Number(chatId));
  res.json({ domains, questions, answers });
});

domainsRouter.post('/saveAnswer', requireProjectAccess, async (req, res) => {
  const { chatId, questionId, selectedOption, customAnswer } = req.body as {
    chatId?: number;
    questionId?: number;
    selectedOption?: number | null;
    customAnswer?: string | null;
  };
  if (!chatId || !questionId) {
    res.status(400).json({ error: 'chatId and questionId are required' });
    return;
  }
  saveDomainAnswer({
    chat_id: chatId,
    question_id: questionId,
    selected_option: selectedOption ?? null,
    custom_answer: customAnswer ?? null,
  });
  res.json({ success: true });
});

domainsRouter.post('/startFinalAssessment', requireProjectAccess, async (req, res) => {
  const { chatId } = req.body as { chatId?: number };
  if (!chatId) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }

  const chat = getChatSession(Number(chatId));
  if (!chat) {
    res.status(404).json({ error: 'Chat session not found' });
    return;
  }

  const questions = getDomainQuestionsByChatId(Number(chatId));
  const answers = getDomainAnswersByChatId(Number(chatId));

  const answersMap = new Map<number, { selected_option: number | null; custom_answer: string | null }>();
  for (const a of answers) {
    answersMap.set(a.question_id, { selected_option: a.selected_option, custom_answer: a.custom_answer });
  }

  for (const q of questions) {
    insertChatMessage({
      chat_id: chatId,
      project_id: chat.project_id,
      stage: 'domain',
      role: 'system',
      message: q.question,
      ready_for_next_stage: true,
    });

    const answer = answersMap.get(q.id);
    if (!answer) continue;

    let answerText: string;
    if (answer.selected_option !== null) {
      const options = JSON.parse(q.options_json) as string[];
      answerText = options[answer.selected_option] ?? '';
    } else {
      answerText = answer.custom_answer ?? '';
    }

    insertChatMessage({
      chat_id: chatId,
      project_id: chat.project_id,
      stage: 'domain',
      role: 'user',
      message: answerText,
      ready_for_next_stage: true,
    });
  }

  transitionTo(Number(chatId), 'final_assessment', 'analysis');
  res.json({ success: true });
});