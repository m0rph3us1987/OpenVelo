import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface FlatQuestion {
  domainId: number;
  domainName: string;
  id: number;
  topic: string;
  question: string;
  options: string[];
  recommendedIndex: number | null;
}

interface Answer {
  selectedOption?: number;
  customAnswer?: string;
}

interface DomainData {
  id: number;
  name: string;
  description: string;
}

export function ChatDomain({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatDomainProps) {
  const { subStage: wsSubStage } = useStageWebSocket({ chatId: chat.id, stage: 'domain', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'quiz') : wsSubStage;

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      'plan': 'Planning domains...',
      'quiz': 'Quiz',
    };
    const subtitle = titleMap[subStage] ?? 'Planning domains...';

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: subStage === 'plan',
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  if (subStage === 'quiz') {
    return <QuizView chat={chat} viewOnly={viewOnly} />;
  }

  return <TextLog key={chat.id} chatId={chat.id} />;
}

interface ChatDomainProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

function QuizView({ chat, viewOnly }: { chat: ChatSession; viewOnly?: boolean }) {
  const [questions, setQuestions] = React.useState<FlatQuestion[]>([]);
  const [domains, setDomains] = React.useState<DomainData[]>([]);
  const [answers, setAnswers] = React.useState<Map<number, Answer>>(new Map());
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [showCustomInput, setShowCustomInput] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/domains?chatId=${chat.id}`)
      .then(res => res.json())
      .then(data => {
        setDomains(data.domains || []);
        const flat: FlatQuestion[] = [];
        for (const domain of data.domains || []) {
          const domainQuestions = (data.questions || []).filter(
            (q: { domain_id: number }) => q.domain_id === domain.id
          );
          for (const q of domainQuestions) {
            flat.push({
              domainId: domain.id,
              domainName: domain.name,
              id: q.id,
              topic: q.topic,
              question: q.question,
              options: JSON.parse(q.options_json),
              recommendedIndex: q.recommended_index,
            });
          }
        }
        setQuestions(flat);

        const savedAnswers = new Map<number, Answer>();
        for (const q of data.questions || []) {
          const answer = (data.answers || []).find(
            (a: { question_id: number }) => a.question_id === q.id
          );
          if (answer) {
            savedAnswers.set(q.id, {
              selectedOption: answer.selected_option ?? undefined,
              customAnswer: answer.custom_answer ?? undefined,
            });
          }
        }
        setAnswers(savedAnswers);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch domain data:', err);
        setLoading(false);
      });
  }, [chat.id]);

  const currentQuestion = questions[currentIndex];

  const isQuestionAnswered = (questionId: number) => {
    const answer = answers.get(questionId);
    return answer && (answer.selectedOption !== undefined || answer?.customAnswer !== undefined);
  };

  const isDomainComplete = (domainId: number) => {
    return questions
      .filter(q => q.domainId === domainId)
      .every(q => isQuestionAnswered(q.id));
  };

  const allAnswered = questions.length > 0 && questions.every(q => isQuestionAnswered(q.id));

  const saveAnswer = React.useCallback(
    (questionId: number, selectedOption: number | null, customAnswer: string | null) => {
      fetch('/api/domains/saveAnswer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id, questionId, selectedOption, customAnswer }),
      }).catch(err => console.error('Failed to save answer:', err));

      setAnswers(prev => {
        const next = new Map(prev);
        if (selectedOption !== null) {
          next.set(questionId, { selectedOption, customAnswer: undefined });
        } else if (customAnswer !== null) {
          next.set(questionId, { selectedOption: undefined, customAnswer });
        }
        return next;
      });
    },
    [chat.id]
  );

  const handleOptionClick = (optionIndex: number) => {
    if (!currentQuestion) return;
    setShowCustomInput(false);
    saveAnswer(currentQuestion.id, optionIndex, null);
  };

  const handleCustomClick = () => {
    if (!currentQuestion) return;
    const existing = answers.get(currentQuestion.id);
    setShowCustomInput(true);
    if (!existing?.customAnswer) {
      saveAnswer(currentQuestion.id, null, '');
    }
  };

  const handleCustomChange = (text: string) => {
    if (!currentQuestion) return;
    saveAnswer(currentQuestion.id, null, text);
  };

  const handleQuestionClick = (questionId: number) => {
    const idx = questions.findIndex(q => q.id === questionId);
    if (idx !== -1) {
      setCurrentIndex(idx);
      const answer = answers.get(questionId);
      setShowCustomInput(answer?.customAnswer !== undefined);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      const prevQ = questions[currentIndex - 1];
      const answer = answers.get(prevQ.id);
      setShowCustomInput(answer?.customAnswer !== undefined);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      const nextQ = questions[currentIndex + 1];
      const answer = answers.get(nextQ.id);
      setShowCustomInput(answer?.customAnswer !== undefined);
    }
  };

  const handleStartFinalAssessment = () => {
    fetch('/api/domains/startFinalAssessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          console.log('[domain:quiz] Final assessment started');
        }
      })
      .catch(err => console.error('Failed to start final assessment:', err));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No questions available
      </div>
    );
  }

  const currentAnswer = answers.get(currentQuestion.id);
  const isCustomSelected = currentAnswer?.customAnswer !== undefined;

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 flex flex-col p-6 overflow-y-auto">
        <Card className="max-w-2xl w-full mx-auto">
          <CardHeader>
            <CardDescription className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {currentQuestion.domainName} / {currentQuestion.topic}
            </CardDescription>
            <CardTitle className="text-lg font-normal mt-2">
              {currentQuestion.question}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentQuestion.options.map((option, idx) => (
              <Button
                key={idx}
                variant={currentAnswer?.selectedOption === idx ? 'default' : 'outline'}
                className="w-full justify-start text-left h-auto py-3 px-4 whitespace-normal"
                onClick={viewOnly ? undefined : () => handleOptionClick(idx)}
                disabled={viewOnly}
              >
                {idx === currentQuestion.recommendedIndex ? '★ ' : '  '}
                {option}
              </Button>
            ))}
            {!viewOnly && (
              <Button
                variant={isCustomSelected ? 'default' : 'outline'}
                className="w-full justify-start text-left h-auto py-3 px-4 whitespace-normal"
                onClick={handleCustomClick}
              >
                {isCustomSelected ? '● ' : '○ '}
                Custom answer
              </Button>
            )}
            {!viewOnly && showCustomInput && (
              <div className="mt-2">
                <textarea
                  rows={5}
                  className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  placeholder="Enter your custom answer..."
                  value={currentAnswer?.customAnswer ?? ''}
                  onChange={e => handleCustomChange(e.target.value)}
                />
              </div>
            )}
            {viewOnly && currentAnswer?.customAnswer !== undefined && (
              <div className="mt-2 p-3 bg-muted rounded-md">
                <p className="text-sm text-muted-foreground font-medium mb-1">Custom answer:</p>
                <p className="text-sm whitespace-pre-wrap">{currentAnswer.customAnswer}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="max-w-2xl w-full mx-auto mt-6 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handlePrev}
            disabled={currentIndex === 0}
          >
            PREVIOUS
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentIndex + 1} / {questions.length}
          </span>
          <Button
            variant="outline"
            onClick={handleNext}
            disabled={currentIndex === questions.length - 1}
          >
            NEXT
          </Button>
        </div>
        {!viewOnly && allAnswered && (
          <div className="max-w-2xl w-full mx-auto mt-4 flex justify-center">
            <Button
              variant="default"
              onClick={handleStartFinalAssessment}
            >
              Start final assessment
            </Button>
          </div>
        )}
      </div>

      <div className="w-80 border-l border-border overflow-y-auto p-4 bg-muted/20">
        <div className="space-y-4">
          {domains.map(domain => {
            const domainComplete = isDomainComplete(domain.id);
            const domainQuestions = questions.filter(q => q.domainId === domain.id);
            return (
              <div key={domain.id} className="space-y-2">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span className={domainComplete ? 'text-green-600' : 'text-muted-foreground'}>
                    {domainComplete ? '✓' : '○'}
                  </span>
                  <span>{domain.name}</span>
                </div>
                <div className="ml-4 space-y-1.5">
                  {domainQuestions.map(q => {
                    const answered = isQuestionAnswered(q.id);
                    return (
                      <button
                        key={q.id}
                        onClick={() => handleQuestionClick(q.id)}
                        className={`w-full text-left text-xs py-1 px-2 rounded hover:bg-accent/50 ${
                          q.id === currentQuestion.id ? 'bg-accent/50 font-medium' : ''
                        }`}
                      >
                        <span className={answered ? 'text-green-600' : 'text-muted-foreground'}>
                          {answered ? '✓' : '○'}
                        </span>
                        <span className="ml-2 truncate">{q.topic}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}