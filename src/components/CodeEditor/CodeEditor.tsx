"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import Groq from "groq-sdk";
import styles from "./CodeEditor.module.css";

interface AnalysisResult {
  timeComplexity: string;
  spaceComplexity: string;
  suggestion?: string;
  correctedCode?: string;
}

interface TestCase {
  input: string;
  expectedOutput: string;
  actualOutput?: string;
  passed?: boolean;
}

const difficultyLevels = ["easy", "medium", "hard"];
const questionTopics = [
  "array",
  "string",
  "tree",
  "graph",
  "stack",
  "queue",
  "hashmap",
  "linkedlist",
  "dynamic programming",
  "recursion",
  "sorting",
  "searching"
];

export default function CodeEditor() {
  const [code, setCode] = useState<string>("");
  const [question, setQuestion] = useState<string>("Loading question...");
  const [analysis, setAnalysis] = useState<AnalysisResult>({
    timeComplexity: "Not analyzed yet",
    spaceComplexity: "Not analyzed yet"
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [language, setLanguage] = useState<string>("java");
  const [questionLoading, setQuestionLoading] = useState<boolean>(true);
  const [showCorrectedCode, setShowCorrectedCode] = useState<boolean>(false);
  const [difficulty, setDifficulty] = useState<string>("medium");
  const [topic, setTopic] = useState<string>("array");
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testResults, setTestResults] = useState<TestCase[]>([]);
  const [runningTests, setRunningTests] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"testcases" | "results">("testcases");

  // Stopwatch State
  const [time, setTime] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const groq = new Groq({
    apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  // Effect for stopwatch
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setTime((prevTime) => prevTime + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRunning]);

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const startStopwatch = () => {
    setIsRunning(true);
  };

  const stopStopwatch = () => {
    setIsRunning(false);
  };

  const resetStopwatch = () => {
    setIsRunning(false);
    setTime(0);
  };

  useEffect(() => {
    generateQuestion();
    resetStopwatch();
  }, [language, difficulty, topic]);

  const generateQuestion = async () => {
    setQuestionLoading(true);
    resetStopwatch();
    try {
      const response = await groq.chat.completions.create({
        messages: [{
          role: "user",
          content: `Generate a ${difficulty} level ${language} coding question about ${topic} that would be appropriate for assessing time and space complexity.
          The question should be challenging but solvable in about 20-30 lines of code.
          Make sure the question clearly relates to ${topic} concepts.
          Also provide 3 test cases in JSON format with input and expected output.
          Return the response in this exact format:
          {
            "question": "The generated question text",
            "testCases": [
              {
                "input": "input value 1",
                "expectedOutput": "expected output 1"
              },
              {
                "input": "input value 2",
                "expectedOutput": "expected output 2"
              },
              {
                "input": "input value 3",
                "expectedOutput": "expected output 3"
              }
            ]
          }`
        }],
        model: "openai/gpt-oss-120b",  // ✅ CORRECT MODEL
        temperature: difficulty === "hard" ? 0.8 : difficulty === "medium" ? 0.7 : 0.6,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Couldn't generate question");
      }

      const result = JSON.parse(content);
      setQuestion(result.question || "Couldn't generate question");
      setTestCases(result.testCases || []);
      setTestResults([]);
      setCode("");
      setAnalysis({
        timeComplexity: "Not analyzed yet",
        spaceComplexity: "Not analyzed yet"
      });
      startStopwatch();
    } catch (error) {
      setQuestion("We couldn't load a question. Please check your connection and try again.");
      console.error("Error generating question:", error);
      stopStopwatch();
    } finally {
      setQuestionLoading(false);
    }
  };

  const analyzeCode = useCallback(async () => {
    if (!code.trim()) {
      setAnalysis({
        timeComplexity: "Not analyzed",
        spaceComplexity: "Not analyzed",
        suggestion: "Please write your solution code first before analyzing."
      });
      return;
    }

    setLoading(true);
    setShowCorrectedCode(false);
    setAnalysis({
      timeComplexity: "Analyzing...",
      spaceComplexity: "Analyzing...",
      suggestion: undefined,
      correctedCode: undefined
    });
    stopStopwatch();

    try {
      const response = await groq.chat.completions.create({
        messages: [{
          role: "user",
          content: `Question: ${question}\n\nAnalyze this solution code and provide ONLY a JSON response with these exact fields:
{
  "timeComplexity": "Big O time complexity (e.g., O(n))",
  "spaceComplexity": "Big O space complexity (e.g., O(1))",
  "suggestion": "Optional suggestions for improvement if needed",
  "correctedCode": "Provide an optimized version of the code if improvements are possible, otherwise return the original code.give the proper code with proper space and syntax"
}

Solution code in ${language}:
\`\`\`${language}
${code}
\`\`\``
        }],
        model: "openai/gpt-oss-120b",  // ✅ CORRECT MODEL
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("The analysis didn't return any results. Please try again.");
      }

      let result: Partial<AnalysisResult> = {};
      try {
        result = JSON.parse(content);
      } catch (e) {
        throw new Error("We couldn't understand the analysis response. Please try again.");
      }

      setAnalysis({
        timeComplexity: result.timeComplexity || "Could not determine",
        spaceComplexity: result.spaceComplexity || "Could not determine",
        suggestion: result.suggestion,
        correctedCode: result.correctedCode
      });
    } catch (error) {
      setAnalysis({
        timeComplexity: "Analysis failed",
        spaceComplexity: "Analysis failed",
        suggestion: error instanceof Error ?
          `Suggestion: ${error.message}` :
          "Something went wrong. Please check your code and try again."
      });
    } finally {
      setLoading(false);
    }
  }, [code, language, question]);

  const runTestCases = async () => {
    if (!code.trim()) {
      alert("Please write your solution code first");
      return;
    }

    setRunningTests(true);
    setTestResults([]);
    setActiveTab("results");
    stopStopwatch();

    try {
      const response = await groq.chat.completions.create({
        messages: [{
          role: "user",
          content: `Question: ${question}\n\nGiven this solution code in ${language}, run these test cases and return the results in JSON format with these exact fields for each test case:
{
  "testResults": [
    {
      "input": "original input",
      "expectedOutput": "original expected output",
      "actualOutput": "the actual output from running the code",
      "passed": true/false
    },
    ...
  ]
}

Solution code:
\`\`\`${language}
${code}
\`\`\`

Test cases to run:
${JSON.stringify(testCases, null, 2)}`
        }],
        model: "openai/gpt-oss-120b",  // ✅ CORRECT MODEL
        temperature: 0,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Test execution failed");
      }

      const result = JSON.parse(content);
      setTestResults(result.testResults || []);
    } catch (error) {
      console.error("Error running tests:", error);
      alert("Failed to run test cases");
    } finally {
      setRunningTests(false);
    }
  };

  const generateNewQuestion = async () => {
    await generateQuestion();
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Coding Challenge</h1>

      <div className={styles.questionSection}>
        <div className={styles.questionHeader}>
          <h2>Challenge Question</h2>
          <button
            onClick={generateNewQuestion}
            disabled={questionLoading}
            className={styles.newQuestionButton}
          >
            {questionLoading ? "Generating..." : "New Question"}
          </button>
        </div>
        <div className={styles.questionBox}>
          {questionLoading ? (
            <div className={styles.loadingQuestion}>Generating question...</div>
          ) : (
            <p className={styles.questionText}>{question}</p>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <label>Language:</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={styles.select}
            disabled={questionLoading}
          >
            {["javascript", "python", "java", "c++", "typescript"].map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label>Difficulty:</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className={styles.select}
            disabled={questionLoading}
          >
            {difficultyLevels.map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label>Topic:</label>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className={styles.select}
            disabled={questionLoading}
          >
            {questionTopics.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <button
          onClick={analyzeCode}
          disabled={loading || questionLoading}
          className={styles.analyzeButton}
        >
          {loading ? "Analyzing..." : "Analyze Solution"}
        </button>

        <button
          onClick={runTestCases}
          disabled={runningTests || questionLoading || testCases.length === 0}
          className={styles.testButton}
        >
          {runningTests ? "Running Tests..." : "Run Test Cases"}
        </button>
      </div>

      <div className={styles.mainContent}>
        <div className={styles.codeEditorContainer}>
          <div className={styles.editorHeader}>
            <h2>Your Solution Code</h2>
            <div className={styles.stopwatch}>
              <span className={styles.stopwatchTime}>{formatTime(time)}</span>
              <div className={styles.stopwatchControls}>
                {!isRunning ? (
                  <button 
                    onClick={startStopwatch} 
                    className={styles.stopwatchButton}
                    disabled={questionLoading}
                  >
                    Start
                  </button>
                ) : (
                  <button 
                    onClick={stopStopwatch} 
                    className={styles.stopwatchButton}
                  >
                    Stop
                  </button>
                )}
                <button 
                  onClick={resetStopwatch} 
                  className={styles.stopwatchButton}
                  disabled={time === 0}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={`Write your ${language} solution here with proper space and syntax...`}
            spellCheck="false"
            className={styles.textarea}
            disabled={questionLoading}
          />
        </div>

        <div className={styles.testCasesPanel}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tabButton} ${activeTab === "testcases" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("testcases")}
            >
              Test Cases
            </button>
            <button
              className={`${styles.tabButton} ${activeTab === "results" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("results")}
            >
              Results
            </button>
          </div>

          {activeTab === "testcases" ? (
            <div className={styles.testCasesContainer}>
              {testCases.length > 0 ? (
                testCases.map((test, index) => (
                  <div key={index} className={styles.testCase}>
                    <div className={styles.testCaseHeader}>
                      <span>Test Case {index + 1}</span>
                    </div>
                    <div className={styles.testCaseContent}>
                      <div>
                        <strong>Input:</strong>
                        <pre>{test.input}</pre>
                      </div>
                      <div>
                        <strong>Expected:</strong>
                        <pre>{test.expectedOutput}</pre>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.noTestCases}>
                  No test cases available for this question
                </div>
              )}
            </div>
          ) : (
            <div className={styles.testResultsContainer}>
              {runningTests ? (
                <div className={styles.loadingTests}>Running tests...</div>
              ) : testResults.length > 0 ? (
                testResults.map((test, index) => (
                  <div key={index} className={`${styles.testCase} ${test.passed ? styles.passed : styles.failed}`}>
                    <div className={styles.testCaseHeader}>
                      <span className={styles.testCaseStatus}>
                        {test.passed ? (
                          <span className={styles.passedIcon}>✓</span>
                        ) : (
                          <span className={styles.failedIcon}>✗</span>
                        )}
                        Test Case {index + 1} {test.passed ? "Passed" : "Failed"}
                      </span>
                    </div>
                    <div className={styles.testCaseContent}>
                      <div>
                        <strong>Input:</strong>
                        <pre>{test.input}</pre>
                      </div>
                      <div>
                        <strong>Expected:</strong>
                        <pre>{test.expectedOutput}</pre>
                      </div>
                      {!test.passed && (
                        <div>
                          <strong>Actual:</strong>
                          <pre>{test.actualOutput}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.noResults}>
                  {testCases.length > 0
                    ? "Run tests to see results"
                    : "No test cases available"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.analysisSection}>
        <h2>Code Analysis</h2>

        <div className={styles.complexityContainer}>
          <div className={styles.complexityBox}>
            <h3>Time Complexity</h3>
            <div className={styles.complexityValue}>
              {loading ? "..." : analysis.timeComplexity}
            </div>
          </div>

          <div className={styles.complexityBox}>
            <h3>Space Complexity</h3>
            <div className={styles.complexityValue}>
              {loading ? "..." : analysis.spaceComplexity}
            </div>
          </div>
        </div>

        {analysis.suggestion && (
          <div className={styles.suggestionBox}>
            <h3>Suggestion</h3>
            <div className={styles.suggestionText}>
              {analysis.suggestion}
            </div>
          </div>
        )}

        {analysis.correctedCode && analysis.correctedCode !== code && (
          <div className={styles.correctedCodeSection}>
            <button
              onClick={() => setShowCorrectedCode(!showCorrectedCode)}
              className={styles.toggleCorrectedCode}
            >
              {showCorrectedCode ? "Hide Corrected Code" : "Show Corrected Code"}
            </button>

            {showCorrectedCode && (
              <div className={styles.correctedCodeBox}>
                <h3>Optimized Solution</h3>
                <pre className={styles.codeBlock}>
                  {analysis.correctedCode}
                </pre>
                <button
                  onClick={() => {
                    setCode(analysis.correctedCode || "");
                    setShowCorrectedCode(false);
                  }}
                  className={styles.useCorrectedButton}
                >
                  Use This Solution
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}