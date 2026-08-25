// src/components/InterviewAssistant/InterviewAssistant.tsx
"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Groq from "groq-sdk";
import styles from "./InterviewAssistant.module.css";

// ============================================================
// TYPES & INTERFACES
// ============================================================
interface ChatHistoryEntry {
  question: string;
  answer: string;
  feedback: string;
  score: number;
  timestamp: number;
}

interface ResultAnalysis {
  overallPerformance: "excellent" | "good" | "average" | "needs improvement";
  strengths: [string, string, string];
  weaknesses: [string, string, string];
  improvementSuggestions: [string, string, string];
}

interface Skill {
  name: string;
  category: "technical" | "soft" | "domain";
}

// NEW: Enhanced evaluation interface
interface AnswerEvaluation {
  score: number;
  relevance: number; // 0-1
  completeness: number; // 0-1
  quality: number; // 0-1
  feedback: string;
  keyPoints: string[];
  matchedKeywords: string[];
  suggestions: string[];
}

// ============================================================
// CONSTANTS
// ============================================================
const MAX_QUESTIONS = 10;
const MIN_ANSWER_LENGTH = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// ✅ CORRECT MODEL for Groq
const DEFAULT_MODEL = "openai/gpt-oss-120b";

const PERFORMANCE_COLORS = {
  excellent: "#4CAF50",
  good: "#8BC34A",
  average: "#FFC107",
  "needs improvement": "#F44336",
} as const;

// NEW: Scoring weights
const SCORING_WEIGHTS = {
  relevance: 0.4,
  completeness: 0.3,
  quality: 0.3,
};

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function InterviewAssistant() {
  // ============================================================
  // STATE
  // ============================================================
  const [groqClient] = useState(() => 
    new Groq({
      apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
      dangerouslyAllowBrowser: true,
    })
  );

  // Resume & Skills
  const [resumeText, setResumeText] = useState<string>("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isResumeValid, setIsResumeValid] = useState<boolean | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // PDF State
  const [pdfReady, setPdfReady] = useState(false);
  const pdfjsRef = useRef<any>(null);

  // Interview State
  const [questions, setQuestions] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [isInterviewing, setIsInterviewing] = useState(false);
  const [isInterviewCompleted, setIsInterviewCompleted] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [resultAnalysis, setResultAnalysis] = useState<ResultAnalysis | null>(null);
  const [selectedMcqOption, setSelectedMcqOption] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [typingIndicator, setTypingIndicator] = useState(false);
  
  // NEW: Track current evaluation for display
  const [currentEvaluation, setCurrentEvaluation] = useState<AnswerEvaluation | null>(null);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // DERIVED STATE
  // ============================================================
  const currentScore = useMemo(() => {
    if (history.length === 0) return 0;
    return history.reduce((acc, entry) => acc + entry.score, 0);
  }, [history]);

  const averageScore = useMemo(() => {
    if (history.length === 0) return 0;
    return Number((currentScore / history.length).toFixed(1));
  }, [history, currentScore]);

  const progress = useMemo(() => {
    if (questions.length === 0) return 0;
    return Math.round((currentQuestionIndex / questions.length) * 100);
  }, [questions, currentQuestionIndex]);

  // ============================================================
  // PDF LOADING - Using Script Tag Approach
  // ============================================================
  useEffect(() => {
    const loadPdfLibrary = () => {
      return new Promise<void>((resolve, reject) => {
        try {
          if (window.pdfjsLib) {
            pdfjsRef.current = window.pdfjsLib;
            setPdfReady(true);
            resolve();
            return;
          }

          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.async = true;
          
          script.onload = () => {
            if (window.pdfjsLib) {
              pdfjsRef.current = window.pdfjsLib;
              window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
              setPdfReady(true);
              console.log('✅ PDF.js loaded successfully');
              resolve();
            } else {
              reject(new Error('PDF.js library not found after loading'));
            }
          };
          
          script.onerror = () => {
            reject(new Error('Failed to load PDF.js library'));
          };
          
          document.head.appendChild(script);
        } catch (error) {
          reject(error);
        }
      });
    };

    loadPdfLibrary().catch((error) => {
      console.error('❌ Failed to load PDF library:', error);
      setError('Failed to load PDF library. Please check your internet connection.');
    });
  }, []);

  // Focus textarea when new question appears
  useEffect(() => {
    if (isInterviewing && !isInterviewCompleted) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [currentQuestion, isInterviewing, isInterviewCompleted]);

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const withRetry = async <T,>(
    fn: () => Promise<T>,
    retries = MAX_RETRIES
  ): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0) {
        await sleep(RETRY_DELAY);
        return withRetry(fn, retries - 1);
      }
      throw error;
    }
  };

  const getPerformanceColor = (performance: string): string => {
    return PERFORMANCE_COLORS[performance as keyof typeof PERFORMANCE_COLORS] || "#9E9E9E";
  };

  const validateResume = (text: string): { isValid: boolean; score: number } => {
    const keywords = ["experience", "education", "skills", "project", "work", "certification", 
                     "professional", "achievement", "responsibility", "accomplishment"];
    const wordCount = text.split(/\s+/).length;
    const keywordCount = keywords.filter(keyword => 
      text.toLowerCase().includes(keyword)
    ).length;
    
    const wordScore = Math.min(wordCount / 100, 1);
    const keywordScore = Math.min(keywordCount / 3, 1);
    const totalScore = (wordScore * 0.6 + keywordScore * 0.4);
    
    return {
      isValid: totalScore > 0.5,
      score: Math.round(totalScore * 100)
    };
  };

  // ============================================================
  // API CALLS - USING CORRECT MODEL
  // ============================================================
  const callGroqAPI = useCallback(async (
    messages: { role: string; content: string }[],
    options: { temperature?: number; responseFormat?: { type: string } } = {}
  ) => {
    const defaultOptions = {
      model: DEFAULT_MODEL,
      temperature: 0.7,
      ...options,
    };

    return withRetry(async () => {
      const response = await groqClient.chat.completions.create({
        messages: messages as any,
        ...defaultOptions,
        max_tokens: 2048,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from API");
      }
      return content;
    });
  }, [groqClient]);

  // ============================================================
  // ENHANCED ANSWER EVALUATION
  // ============================================================
  const evaluateAnswer = useCallback(async (
    question: string,
    answer: string,
    skills: Skill[]
  ): Promise<AnswerEvaluation> => {
    const trimmedAnswer = answer.trim();
    const wordCount = trimmedAnswer.split(/\s+/).length;
    
    // Extract key concepts from the question
    const questionWords = question.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['what', 'when', 'where', 'which', 'who', 'why', 'how', 'would', 'could', 'should'].includes(word));
    
    // Extract keywords from answer
    const answerWords = trimmedAnswer.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/);
    
    // Calculate keyword overlap
    const matchedKeywords = questionWords.filter(word => 
      answerWords.some(ansWord => ansWord.includes(word) || word.includes(ansWord))
    );
    
    // Calculate relevance score based on keyword matching
    let relevanceScore = 0;
    if (questionWords.length > 0) {
      relevanceScore = matchedKeywords.length / questionWords.length;
    }
    
    // Check for technical keywords from skills
    const skillKeywords = skills.map(s => s.name.toLowerCase());
    const matchedSkills = skillKeywords.filter(skill => 
      answerWords.some(word => word.includes(skill) || skill.includes(word))
    );
    
    // Boost relevance if technical skills are mentioned
    const skillBoost = Math.min(matchedSkills.length / 3, 0.3);
    relevanceScore = Math.min(relevanceScore + skillBoost, 1);
    
    // Calculate completeness based on answer length and structure
    let completenessScore = 0;
    if (wordCount >= 50) {
      completenessScore = 1.0;
    } else if (wordCount >= 30) {
      completenessScore = 0.75;
    } else if (wordCount >= 15) {
      completenessScore = 0.5;
    } else if (wordCount >= 10) {
      completenessScore = 0.25;
    } else {
      completenessScore = 0;
    }
    
    // Check for structure indicators
    const hasStructure = /first|second|third|finally|additionally|moreover|furthermore|however|consequently|therefore|for example|for instance|specifically|in particular/.test(trimmedAnswer);
    if (hasStructure && completenessScore > 0.5) {
      completenessScore = Math.min(completenessScore + 0.1, 1);
    }
    
    // Calculate quality using AI evaluation
    let qualityScore = 0;
    let aiFeedback = "";
    let suggestions: string[] = [];
    
    try {
      const evaluation = await callGroqAPI([
        {
          role: "system",
          content: `You are a senior interviewer evaluating a candidate's answer. 
          Assess the quality of the response based on:
          1. Clarity and structure of explanation
          2. Use of relevant examples
          3. Depth of understanding
          4. Critical thinking demonstrated
          
          Provide:
          - A quality score (0-1)
          - Brief feedback
          - Improvement suggestions
          Return as JSON: { score: number, feedback: string, suggestions: string[] }`
        },
        {
          role: "user",
          content: `Question: "${question}"
          Answer: "${trimmedAnswer}"
          
          Evaluate the quality of this answer.`
        }
      ], { temperature: 0.3 });
      
      try {
        const parsed = JSON.parse(evaluation);
        qualityScore = Math.min(Math.max(parsed.score || 0.5, 0), 1);
        aiFeedback = parsed.feedback || "";
        suggestions = parsed.suggestions || [];
      } catch {
        qualityScore = 0.5;
      }
    } catch {
      qualityScore = 0.5;
    }
    
    // Calculate final score
    const rawScore = (
      relevanceScore * SCORING_WEIGHTS.relevance +
      completenessScore * SCORING_WEIGHTS.completeness +
      qualityScore * SCORING_WEIGHTS.quality
    );
    
    // Scale to 1-10 with thresholds
    let finalScore = 0;
    if (rawScore >= 0.9) {
      finalScore = 9 + (rawScore - 0.9) * 10;
    } else if (rawScore >= 0.7) {
      finalScore = 7 + (rawScore - 0.7) * 10;
    } else if (rawScore >= 0.5) {
      finalScore = 5 + (rawScore - 0.5) * 10;
    } else if (rawScore >= 0.3) {
      finalScore = 3 + (rawScore - 0.3) * 10;
    } else {
      finalScore = rawScore * 10;
    }
    
    finalScore = Math.min(Math.max(Math.round(finalScore * 10) / 10, 0), 10);
    
    // Generate detailed feedback
    let feedback = "";
    if (wordCount < 10) {
      feedback = "Your answer is too brief. Please provide more detail and explanation.";
    } else if (relevanceScore < 0.3) {
      feedback = "Your answer doesn't seem to address the question directly. Please focus on the specific question asked.";
    } else if (completenessScore < 0.5) {
      feedback = "Consider elaborating more with specific examples and structured reasoning.";
    } else if (qualityScore < 0.5) {
      feedback = aiFeedback || "Good effort! Try to include more specific examples and demonstrate deeper understanding.";
    } else {
      feedback = aiFeedback || "Excellent answer! You demonstrated good understanding and provided thorough explanation.";
    }
    
    // Add specific suggestions
    if (matchedKeywords.length === 0 && questionWords.length > 0) {
      suggestions.push(`Consider using these key terms in your answer: ${questionWords.slice(0, 3).join(', ')}`);
    }
    
    if (matchedSkills.length === 0 && skillKeywords.length > 0) {
      suggestions.push(`Try incorporating relevant technical terms like: ${skillKeywords.slice(0, 3).join(', ')}`);
    }
    
    if (!hasStructure && wordCount > 20) {
      suggestions.push("Use structure words (first, second, finally) to organize your answer better.");
    }
    
    // Combine feedback
    if (suggestions.length > 0) {
      feedback += " 💡 " + suggestions.slice(0, 2).join(" ");
    }
    
    return {
      score: finalScore,
      relevance: Math.round(relevanceScore * 100) / 100,
      completeness: Math.round(completenessScore * 100) / 100,
      quality: Math.round(qualityScore * 100) / 100,
      feedback,
      keyPoints: matchedKeywords,
      matchedKeywords: matchedKeywords,
      suggestions,
    };
  }, [callGroqAPI]);

  // ============================================================
  // PDF PROCESSING
  // ============================================================
  const processPDF = useCallback(async (file: File): Promise<string> => {
    if (!pdfReady || !pdfjsRef.current) {
      throw new Error("PDF library is not ready. Please wait...");
    }

    const pdfjs = pdfjsRef.current;
    const arrayBuffer = await file.arrayBuffer();
    const pdfData = new Uint8Array(arrayBuffer);

    const loadingTask = pdfjs.getDocument({
      data: pdfData,
      useSystemFonts: false,
      disableFontFace: false,
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    let extractedText = "";
    let processedPages = 0;

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: true,
      });

      const pageText = textContent.items
        .map((item: any) => item.str || "")
        .filter((str: string) => str.trim().length > 0)
        .join(" ")
        .trim();

      if (pageText) {
        extractedText += pageText + "\n";
      }

      processedPages++;
      const progress = Math.round((processedPages / totalPages) * 100);
      setUploadProgress(progress);
    }

    await pdf.destroy();
    return extractedText.trim();
  }, [pdfReady]);

  // ============================================================
  // RESUME HANDLING
  // ============================================================
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setError("No file selected");
      return;
    }

    const validTypes = ["application/pdf", "application/x-pdf"];
    if (!validTypes.includes(file.type)) {
      setError("Please upload a valid PDF file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("File size exceeds 10MB limit");
      return;
    }

    if (!pdfReady) {
      setError("PDF library is loading. Please wait...");
      return;
    }

    setError(null);
    setIsProcessing(true);
    setIsResumeValid(null);
    setUploadProgress(0);

    try {
      const extractedText = await processPDF(file);
      
      if (!extractedText || extractedText.length < 50) {
        throw new Error("Could not extract sufficient text from the PDF");
      }

      const validation = validateResume(extractedText);
      
      if (!validation.isValid) {
        setIsResumeValid(false);
        setError(`The uploaded file doesn't appear to be a valid resume (quality score: ${validation.score}%). Please upload a proper resume.`);
        return;
      }

      setResumeText(extractedText);
      
      const skillResponse = await callGroqAPI([
        {
          role: "system",
          content: `You are a skill extraction expert. Extract and categorize skills from the resume.
          Return ONLY a JSON object with this exact structure:
          {
            "technical": ["skill1", "skill2", ...],
            "soft": ["skill1", "skill2", ...],
            "domain": ["skill1", "skill2", ...]
          }
          Limit to top 20 skills total.`
        },
        {
          role: "user",
          content: `Extract skills from this resume (truncated to 5000 chars):
          ${extractedText.substring(0, 5000)}`
        }
      ], { temperature: 0.3 });

      let parsedSkills: { technical: string[]; soft: string[]; domain: string[] };
      try {
        const cleanedResponse = skillResponse
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();
        parsedSkills = JSON.parse(cleanedResponse);
        
        parsedSkills = {
          technical: parsedSkills.technical || [],
          soft: parsedSkills.soft || [],
          domain: parsedSkills.domain || [],
        };
      } catch {
        const allSkills = skillResponse
          .split(/,|\n/)
          .map(s => s.trim())
          .filter(s => s.length > 0)
          .slice(0, 20);
        
        parsedSkills = {
          technical: allSkills.slice(0, 10),
          soft: allSkills.slice(10, 15),
          domain: allSkills.slice(15, 20),
        };
      }

      const allSkills: Skill[] = [
        ...parsedSkills.technical.map(name => ({ name, category: "technical" as const })),
        ...parsedSkills.soft.map(name => ({ name, category: "soft" as const })),
        ...parsedSkills.domain.map(name => ({ name, category: "domain" as const })),
      ];

      setSkills(allSkills);
      setIsResumeValid(true);
      
      setQuestions([]);
      setHistory([]);
      setTotalScore(0);
      setCurrentQuestionIndex(0);
      setIsInterviewCompleted(false);
      setResultAnalysis(null);
      
      console.log(`✅ Extracted ${allSkills.length} skills from resume`);
    } catch (error) {
      console.error("❌ Error processing resume:", error);
      setError(error instanceof Error ? error.message : "Failed to process resume");
      setIsResumeValid(false);
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [callGroqAPI, processPDF, pdfReady]);

  // ============================================================
  // INTERVIEW FUNCTIONS
  // ============================================================
  const generateQuestions = useCallback(async () => {
    if (skills.length === 0) {
      setError("No skills available to generate questions");
      return [];
    }

    setTypingIndicator(true);
    const skillSummary = skills
      .map(s => `${s.name} (${s.category})`)
      .join(", ");

    try {
      const questionResponse = await callGroqAPI([
        {
          role: "system",
          content: `You are a senior technical interviewer. Generate 10 diverse interview questions.
          Questions should cover technical expertise, problem-solving, and behavioral aspects.
          Return ONLY the questions as a numbered list (1-10).`
        },
        {
          role: "user",
          content: `Generate 10 interview questions based on these skills: ${skillSummary}
          Include a mix of:
          - Technical deep-dive questions
          - Problem-solving scenarios
          - Behavioral questions
          - System design (if applicable)`
        }
      ], { temperature: 0.8 });

      const generatedQuestions = questionResponse
        .split('\n')
        .filter(q => q.trim().length > 0)
        .map(q => q.replace(/^\d+\.\s*/, '').trim())
        .filter(q => q.length > 15)
        .slice(0, MAX_QUESTIONS);

      if (generatedQuestions.length === 0) {
        throw new Error("No questions were generated");
      }

      console.log(`✅ Generated ${generatedQuestions.length} questions`);
      return generatedQuestions;
    } catch (error) {
      console.error("❌ Error generating questions:", error);
      setError("Failed to generate interview questions. Please try again.");
      return [];
    } finally {
      setTypingIndicator(false);
    }
  }, [skills, callGroqAPI]);

  const startInterview = useCallback(async () => {
    if (skills.length === 0) {
      setError("Please upload a resume first");
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const generatedQuestions = await generateQuestions();
      
      if (generatedQuestions.length === 0) {
        throw new Error("No questions generated");
      }

      setQuestions(generatedQuestions);
      setCurrentQuestionIndex(0);
      setCurrentQuestion(generatedQuestions[0]);
      setHistory([]);
      setTotalScore(0);
      setIsInterviewing(true);
      setIsInterviewCompleted(false);
      setResultAnalysis(null);
      setSelectedMcqOption(null);
      setCurrentEvaluation(null);
      
      console.log("✅ Interview started");
    } catch (error) {
      console.error("❌ Error starting interview:", error);
      setError("Failed to start interview. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [skills, generateQuestions]);

  // UPDATED: submitAnswer with enhanced evaluation
  const submitAnswer = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      setError("Please write an answer before submitting");
      return;
    }

    if (trimmedAnswer.length < MIN_ANSWER_LENGTH) {
      setError(`Please provide a more detailed answer (minimum ${MIN_ANSWER_LENGTH} characters)`);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setTypingIndicator(true);

    try {
      // Use enhanced evaluation
      const evaluation = await evaluateAnswer(currentQuestion, trimmedAnswer, skills);
      setCurrentEvaluation(evaluation);
      
      const entry: ChatHistoryEntry = {
        question: currentQuestion,
        answer: trimmedAnswer,
        feedback: evaluation.feedback,
        score: evaluation.score,
        timestamp: Date.now(),
      };

      const updatedHistory = [...history, entry];
      setHistory(updatedHistory);
      setTotalScore(prev => prev + evaluation.score);
      setAnswer("");

      if (currentQuestionIndex + 1 < questions.length) {
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        setCurrentQuestion(questions[nextIndex]);
        console.log(`📝 Moving to question ${nextIndex + 1}/${questions.length}`);
      } else {
        await completeInterview(updatedHistory);
      }
    } catch (error) {
      console.error("❌ Error submitting answer:", error);
      setError("Failed to evaluate answer. Please try again.");
    } finally {
      setIsSubmitting(false);
      setTypingIndicator(false);
    }
  }, [answer, currentQuestion, currentQuestionIndex, history, questions, evaluateAnswer, skills]);

  const completeInterview = useCallback(async (finalHistory: ChatHistoryEntry[]) => {
    setIsProcessing(true);
    setTypingIndicator(true);

    try {
      const analysisResponse = await callGroqAPI([
        {
          role: "system",
          content: `You are an expert interview analyst. Analyze the interview results.

          Return ONLY valid JSON with this structure:
          {
            "overallPerformance": "excellent" | "good" | "average" | "needs improvement",
            "strengths": ["strength1", "strength2", "strength3"],
            "weaknesses": ["weakness1", "weakness2", "weakness3"],
            "improvementSuggestions": ["suggestion1", "suggestion2", "suggestion3"],
            "detailedAnalysis": "brief summary of overall performance"
          }`
        },
        {
          role: "user",
          content: `Analyze these interview results:
          ${JSON.stringify(finalHistory.map(h => ({
            question: h.question,
            answer: h.answer,
            score: h.score
          })), null, 2)}`
        }
      ], { 
        temperature: 0.5,
        responseFormat: { type: "json_object" }
      });

      let parsedAnalysis: ResultAnalysis;
      try {
        const raw = JSON.parse(analysisResponse);
        
        const performance = raw.overallPerformance?.toLowerCase() || "average";
        const validPerformance = ["excellent", "good", "average", "needs improvement"].includes(performance)
          ? performance as ResultAnalysis["overallPerformance"]
          : "average";

        const strengths = Array.isArray(raw.strengths) && raw.strengths.length >= 3
          ? raw.strengths.slice(0, 3)
          : ["Good communication", "Technical knowledge", "Problem-solving skills"];
        
        const weaknesses = Array.isArray(raw.weaknesses) && raw.weaknesses.length >= 3
          ? raw.weaknesses.slice(0, 3)
          : ["Could be more concise", "Need more specific examples", "Practice structured responses"];
        
        const suggestions = Array.isArray(raw.improvementSuggestions) && raw.improvementSuggestions.length >= 3
          ? raw.improvementSuggestions.slice(0, 3)
          : ["Review core concepts", "Practice with mock interviews", "Study industry best practices"];

        parsedAnalysis = {
          overallPerformance: validPerformance,
          strengths: strengths as [string, string, string],
          weaknesses: weaknesses as [string, string, string],
          improvementSuggestions: suggestions as [string, string, string],
        };
      } catch (parseError) {
        console.error("❌ Failed to parse analysis:", parseError);
        const avgScore = finalHistory.reduce((acc, h) => acc + h.score, 0) / finalHistory.length;
        parsedAnalysis = {
          overallPerformance: avgScore >= 7 ? "good" : avgScore >= 5 ? "average" : "needs improvement",
          strengths: ["Good communication", "Technical knowledge", "Problem-solving skills"],
          weaknesses: ["Could be more concise", "Need more specific examples", "Practice structured responses"],
          improvementSuggestions: ["Review core concepts", "Practice with mock interviews", "Study industry best practices"],
        };
      }

      setResultAnalysis(parsedAnalysis);
      setIsInterviewing(false);
      setIsInterviewCompleted(true);
      console.log("✅ Interview completed with analysis");
    } catch (error) {
      console.error("❌ Error completing interview:", error);
      setError("Failed to analyze results. Please try again.");
      setIsInterviewing(false);
      setIsInterviewCompleted(true);
    } finally {
      setIsProcessing(false);
      setTypingIndicator(false);
    }
  }, [callGroqAPI]);

  // ============================================================
  // UI RENDER FUNCTIONS
  // ============================================================
  
  // NEW: Render evaluation breakdown
  const renderEvaluationBreakdown = (evaluation: AnswerEvaluation) => (
    <div className={styles.evaluationBreakdown}>
      <h4>📊 Answer Analysis</h4>
      <div className={styles.evaluationMetrics}>
        <div className={styles.metric}>
          <span>Relevance</span>
          <div className={styles.metricBar}>
            <div 
              className={styles.metricFill}
              style={{ width: `${evaluation.relevance * 100}%` }}
            />
          </div>
          <span>{Math.round(evaluation.relevance * 100)}%</span>
        </div>
        <div className={styles.metric}>
          <span>Completeness</span>
          <div className={styles.metricBar}>
            <div 
              className={styles.metricFill}
              style={{ width: `${evaluation.completeness * 100}%` }}
            />
          </div>
          <span>{Math.round(evaluation.completeness * 100)}%</span>
        </div>
        <div className={styles.metric}>
          <span>Quality</span>
          <div className={styles.metricBar}>
            <div 
              className={styles.metricFill}
              style={{ width: `${evaluation.quality * 100}%` }}
            />
          </div>
          <span>{Math.round(evaluation.quality * 100)}%</span>
        </div>
      </div>
      {evaluation.matchedKeywords.length > 0 && (
        <div className={styles.matchedKeywords}>
          <strong>Key terms identified:</strong>
          <div className={styles.keywordTags}>
            {evaluation.matchedKeywords.map((keyword, i) => (
              <span key={i} className={styles.keywordTag}>{keyword}</span>
            ))}
          </div>
        </div>
      )}
      {evaluation.suggestions.length > 0 && (
        <div className={styles.suggestionsList}>
          <strong>💡 Suggestions:</strong>
          <ul>
            {evaluation.suggestions.slice(0, 3).map((suggestion, i) => (
              <li key={i}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const renderScorePanel = () => (
    <div className={styles.scorePanel}>
      <div className={styles.scoreContainer}>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>Current Score</span>
          <span className={styles.scoreValue}>{currentScore}/{history.length * 10}</span>
        </div>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>Average</span>
          <span className={styles.scoreValue}>{averageScore}/10</span>
        </div>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>Progress</span>
          <span className={styles.scoreValue}>{currentQuestionIndex}/{questions.length}</span>
        </div>
      </div>
      <div className={styles.progressBar}>
        <div 
          className={styles.progressFill} 
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );

  const renderResults = () => {
    if (!isInterviewCompleted || !resultAnalysis) return null;

    const avgScore = (totalScore / questions.length).toFixed(1);
    const performanceColor = getPerformanceColor(resultAnalysis.overallPerformance);

    return (
      <div className={styles.resultsContainer}>
        <h2>📊 Interview Results</h2>
        
        <div className={styles.resultsSummary}>
          <div className={styles.summaryCard}>
            <h3>Overall Performance</h3>
            <div 
              className={styles.performanceBadge}
              style={{ backgroundColor: performanceColor }}
            >
              {resultAnalysis.overallPerformance}
            </div>
            <p>Average Score: <strong>{avgScore}/10</strong></p>
            <p>Total Score: <strong>{totalScore}/{questions.length * 10}</strong></p>
            <p>Questions Answered: <strong>{history.length}/{questions.length}</strong></p>
          </div>
          
          <div className={styles.summaryCard}>
            <h3>Self-Assessment</h3>
            <p>How would you rate your performance?</p>
            <div className={styles.mcqOptions}>
              {[1, 2, 3, 4, 5].map((option) => (
                <button
                  key={option}
                  className={`${styles.mcqOption} ${selectedMcqOption === option ? styles.selected : ''}`}
                  onClick={() => setSelectedMcqOption(option)}
                  aria-label={`Rate performance ${option} out of 5`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className={styles.mcqLabels}>
              <span>Poor</span>
              <span>Fair</span>
              <span>Good</span>
              <span>Very Good</span>
              <span>Excellent</span>
            </div>
          </div>
        </div>

        <div className={styles.analysisSection}>
          <div className={styles.analysisColumn}>
            <h3>💪 Your Strengths</h3>
            <ul>
              {resultAnalysis.strengths.map((strength, i) => (
                <li key={i} className={styles.strengthItem}>
                  <span className={styles.bullet}>✓</span> {strength}
                </li>
              ))}
            </ul>
          </div>
          
          <div className={styles.analysisColumn}>
            <h3>📈 Areas for Improvement</h3>
            <ul>
              {resultAnalysis.weaknesses.map((weakness, i) => (
                <li key={i} className={styles.weaknessItem}>
                  <span className={styles.bullet}>⚠</span> {weakness}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={styles.suggestionsSection}>
          <h3>📝 Recommendations</h3>
          <ol>
            {resultAnalysis.improvementSuggestions.map((suggestion, i) => (
              <li key={i}>{suggestion}</li>
            ))}
          </ol>
        </div>

        <div className={styles.actionButtons}>
          <button 
            className={`${styles.button} ${styles.primaryButton}`}
            onClick={() => {
              setIsInterviewCompleted(false);
              setHistory([]);
              setTotalScore(0);
              startInterview();
            }}
            disabled={isProcessing}
          >
            🔄 Retake Interview
          </button>
          <button 
            className={`${styles.button} ${styles.secondaryButton}`}
            onClick={() => {
              setIsInterviewCompleted(false);
              setHistory([]);
              setTotalScore(0);
              setSkills([]);
              setResumeText("");
              setIsResumeValid(null);
              setQuestions([]);
              setResultAnalysis(null);
              setError(null);
            }}
          >
            📄 Upload New Resume
          </button>
        </div>
      </div>
    );
  };

  const renderHistory = () => (
    <div className={styles.history}>
      {history.map((entry, index) => (
        <div key={index} className={styles.message}>
          <div className={styles.messageHeader}>
            <span className={styles.questionNumber}>Question {index + 1}</span>
            <span className={`${styles.scoreBadge} ${
              entry.score >= 7 ? styles.highScore : 
              entry.score >= 4 ? styles.mediumScore : 
              styles.lowScore
            }`}>
              Score: {entry.score}/10
            </span>
          </div>
          <p><strong>Question:</strong> {entry.question}</p>
          <p><strong>Your Answer:</strong> {entry.answer}</p>
          <p><strong>Feedback:</strong> {entry.feedback}</p>
        </div>
      ))}
    </div>
  );

  const renderSkillsPreview = () => (
    <div className={styles.skillsPreview}>
      <h3>Detected Skills</h3>
      <div className={styles.skillsTags}>
        {skills.map((skill, index) => (
          <span key={index} className={`${styles.skillTag} ${styles[skill.category]}`}>
            {skill.name}
          </span>
        ))}
      </div>
    </div>
  );

  // ============================================================
  // MAIN RENDER
  // ============================================================
  return (
    <div className={styles.container}>
      <h1>🤖 AI Interview Assistant</h1>

      {error && (
        <div className={styles.errorBanner}>
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {isInterviewing && renderScorePanel()}

      {isInterviewCompleted ? (
        renderResults()
      ) : (
        <>
          <div className={styles.uploadSection}>
            <div className={styles.uploadArea}>
              <label className={styles.uploadButton}>
                📄 Upload Your Resume (PDF)
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileUpload}
                  disabled={isProcessing || isInterviewing || !pdfReady}
                  style={{ display: "none" }}
                />
              </label>
              {!pdfReady && (
                <div className={styles.loadingIndicator}>
                  <span>⏳ Loading PDF library...</span>
                </div>
              )}
              {isProcessing && (
                <div className={styles.progressContainer}>
                  <div className={styles.progressBar}>
                    <div 
                      className={styles.progressFill} 
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <span>{uploadProgress}% processed</span>
                </div>
              )}
              {isResumeValid === true && (
                <p className={styles.successMessage}>
                  ✅ Resume processed! Found {skills.length} skills.
                </p>
              )}
            </div>
          </div>

          {isResumeValid && !isInterviewing && (
            <button
              onClick={startInterview}
              className={`${styles.button} ${styles.primaryButton}`}
              disabled={isProcessing || skills.length === 0}
            >
              {isProcessing ? "⏳ Starting..." : "🚀 Start Interview"}
            </button>
          )}

          {isResumeValid && skills.length > 0 && !isInterviewing && !isProcessing && (
            renderSkillsPreview()
          )}

          {renderHistory()}

          {isInterviewing && !isInterviewCompleted && (
            <div className={styles.questionContainer}>
              <div className={styles.questionHeader}>
                <span className={styles.questionCounter}>
                  Question {currentQuestionIndex + 1} of {questions.length}
                </span>
                {typingIndicator && (
                  <span className={styles.typingIndicator}>AI is thinking...</span>
                )}
              </div>
              <p className={styles.questionText}>{currentQuestion}</p>
              
              <form onSubmit={submitAnswer} className={styles.form}>
                <textarea
                  ref={textareaRef}
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !isSubmitting) {
                      e.preventDefault();
                      submitAnswer(e);
                    }
                  }}
                  placeholder="Type your answer here... (Press Enter to submit, Shift+Enter for new line)"
                  className={styles.input}
                  rows={4}
                  disabled={isSubmitting}
                />
                <div className={styles.formFooter}>
                  <span className={styles.charCount}>
                    {answer.length} characters {answer.length < MIN_ANSWER_LENGTH && `(min ${MIN_ANSWER_LENGTH})`}
                  </span>
                  <button 
                    type="submit" 
                    className={styles.button}
                    disabled={isSubmitting || !answer.trim()}
                  >
                    {isSubmitting ? "⏳ Submitting..." : "📤 Submit Answer"}
                  </button>
                </div>
              </form>
              
              {/* Show evaluation breakdown after submission */}
              {currentEvaluation && !isSubmitting && (
                renderEvaluationBreakdown(currentEvaluation)
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}