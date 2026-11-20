import React, { useState, useEffect } from 'react';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { supabase } from './lib/supabase';

interface Question {
  id: string;
  track: string;
  question_text: string;
  options: string[];
  correct_index: number;
  explanation: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  level: 'Foundation' | 'Intermediate' | 'Advanced';
}

// Validate data received from Supabase before the UI uses it.
function parseQuestions(data: unknown): Question[] {
  if (!Array.isArray(data)) {
    throw new Error('The questions response was not a list. Please check the database response.');
  }

  return data.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`Question row ${index + 1} is not a valid object.`);
    }

    const value = row as Record<string, unknown>;
    const options = value.options;

    if (typeof value.id !== 'string' || !value.id.trim()) {
      throw new Error(`Question row ${index + 1} has an invalid ID.`);
    }
    if (typeof value.track !== 'string' || !value.track.trim()) {
      throw new Error(`Question row ${index + 1} has an invalid track.`);
    }
    if (typeof value.question_text !== 'string' || !value.question_text.trim()) {
      throw new Error(`Question row ${index + 1} has empty question text.`);
    }
    if (
      !Array.isArray(options) ||
      options.length < 2 ||
      !options.every((option) => typeof option === 'string' && option.trim().length > 0)
    ) {
      throw new Error(`Question row ${index + 1} must contain at least two non-empty options.`);
    }
    if (
      !Number.isInteger(value.correct_index) ||
      (value.correct_index as number) < 0 ||
      (value.correct_index as number) >= options.length
    ) {
      throw new Error(`Question row ${index + 1} has an invalid correct answer index.`);
    }
    if (value.explanation !== null && value.explanation !== undefined && typeof value.explanation !== 'string') {
      throw new Error(`Question row ${index + 1} has an invalid explanation.`);
    }
    if (!['Easy', 'Medium', 'Hard'].includes(String(value.difficulty))) {
      throw new Error(`Question row ${index + 1} has an invalid difficulty.`);
    }
    if (!['Foundation', 'Intermediate', 'Advanced'].includes(String(value.level))) {
      throw new Error(`Question row ${index + 1} has an invalid level.`);
    }

    return {
      id: value.id,
      track: value.track,
      question_text: value.question_text,
      options: options as string[],
      correct_index: value.correct_index as number,
      explanation: typeof value.explanation === 'string' ? value.explanation : '',
      difficulty: value.difficulty as Question['difficulty'],
      level: value.level as Question['level'],
    };
  });
}

WebBrowser.maybeCompleteAuthSession();

const AUTH_REDIRECT_URL = 'sangarya-it-quiz://auth/callback';
const TIME_LIMIT = 30; // seconds per question in Timed mode

export default function App() {
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<string>('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('All');
  const [selectedLevel, setSelectedLevel] = useState<string>('All');
  const [isTimedMode, setIsTimedMode] = useState<boolean>(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    loadQuestions();
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function signInWithGoogle() {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: AUTH_REDIRECT_URL,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Supabase did not return an authentication URL.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT_URL);
      if (result.type === 'success') {
        const callbackUrl = new URL(result.url);
        const fragment = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
        const authErrorDescription =
          callbackUrl.searchParams.get('error_description') ||
          callbackUrl.searchParams.get('error') ||
          fragment.get('error_description') ||
          fragment.get('error');
        if (authErrorDescription) throw new Error(authErrorDescription);

        const code = callbackUrl.searchParams.get('code') || fragment.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          // Some OAuth configurations return tokens in the URL fragment instead of a PKCE code.
          const access_token = fragment.get('access_token') || callbackUrl.searchParams.get('access_token');
          const refresh_token = fragment.get('refresh_token') || callbackUrl.searchParams.get('refresh_token');
          if (!access_token || !refresh_token) {
            throw new Error('Google sign-in returned without an authorization code or session tokens. Please try again.');
          }
          const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
          if (sessionError) throw sessionError;
        }
      } else if (result.type === 'error') {
        throw new Error('Google sign-in could not be completed. Please try again.');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Google sign-in failed.');
    } finally {
      setIsSigningIn(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
    setIsGuest(false);
  }

  async function loadQuestions() {
    setLoading(true);
    setLoadError(null);

    try {
      const { data, error } = await supabase
        .from('questions')
        .select('id, track, question_text, options, correct_index, explanation, difficulty, level, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      setAllQuestions(parseQuestions(data ?? []));
    } catch (error) {
      console.error('Unable to load interview questions:', error);
      setAllQuestions([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while loading questions.'
      );
    } finally {
      setLoading(false);
    }
  }

  // Derive unique categories dynamically from Supabase rows
  const tracks = ['All', ...Array.from(new Set(allQuestions.map((q) => q.track).filter(Boolean)))];

  // Filter questions by active category
  const filteredQuestions = allQuestions.filter((q) =>
    (selectedTrack === 'All' || q.track === selectedTrack) &&
    (selectedDifficulty === 'All' || q.difficulty === selectedDifficulty) &&
    (selectedLevel === 'All' || q.level === selectedLevel)
  );

  // Keep one interval per active question; state updates cannot drift below zero.
  useEffect(() => {
    if (!isTimedMode || loading || filteredQuestions.length === 0 || timeLeft === 0) return;
    if (currentIndex >= filteredQuestions.length || selectedOption !== null || showExplanation) return;

    const timer = setInterval(() => {
      setTimeLeft((previous) => Math.max(0, previous - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isTimedMode, loading, filteredQuestions.length, currentIndex, selectedOption, showExplanation, timeLeft]);

  // Reveal the answer once the countdown reaches zero.
  useEffect(() => {
    if (
      isTimedMode &&
      !loading &&
      filteredQuestions.length > 0 &&
      currentIndex < filteredQuestions.length &&
      timeLeft === 0 &&
      selectedOption === null &&
      !showExplanation
    ) {
      setShowExplanation(true);
    }
  }, [isTimedMode, loading, filteredQuestions.length, currentIndex, timeLeft, selectedOption, showExplanation]);

  const handleTrackChange = (track: string) => {
    setSelectedTrack(track);
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowExplanation(false);
    setScore(0);
    setTimeLeft(TIME_LIMIT);
  };

  const resetForFilterChange = () => {
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowExplanation(false);
    setScore(0);
    setTimeLeft(TIME_LIMIT);
  };

  const handleDifficultyChange = (difficulty: string) => {
    setSelectedDifficulty(difficulty);
    resetForFilterChange();
  };

  const handleLevelChange = (level: string) => {
    setSelectedLevel(level);
    resetForFilterChange();
  };

  const toggleTimerMode = () => {
    setIsTimedMode((prev) => !prev);
    setTimeLeft(TIME_LIMIT);
  };

  const handleSelect = (index: number) => {
    if (selectedOption !== null || showExplanation || (isTimedMode && timeLeft === 0)) return;
    setSelectedOption(index);
    setShowExplanation(true);
    if (index === filteredQuestions[currentIndex].correct_index) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNext = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    setTimeLeft(TIME_LIMIT);
    setCurrentIndex((prev) => prev + 1);
  };

  const restartQuiz = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    setTimeLeft(TIME_LIMIT);
    setCurrentIndex(0);
    setScore(0);
  };

  if (authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={{ marginTop: 12, color: '#64748B' }}>Checking your account...</Text>
      </View>
    );
  }

  if (!session && !isGuest) {
    return (
      <SafeAreaView style={styles.wrapper}>
        <View style={styles.authContainer}>
          <Text style={styles.authTitle}>Sangarya IT Quiz</Text>
          <Text style={styles.authSubtitle}>Practise. Improve. Get interview-ready.</Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={signInWithGoogle} disabled={isSigningIn}>
            {isSigningIn ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>Continue with Google</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.guestButton} onPress={() => { setAuthError(null); setIsGuest(true); }}>
            <Text style={styles.guestButtonText}>Continue as Guest</Text>
          </TouchableOpacity>
          {authError ? <Text style={styles.authError}>{authError}</Text> : null}
          <Text style={styles.authFootnote}>Sign in to keep your account ready for saved scores and quiz history. Guest practice does not require an account.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={{ marginTop: 12, color: '#64748B' }}>Loading Interview Questions...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Unable to Load Questions</Text>
        <Text style={styles.body}>{loadError}</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={loadQuestions}>
          <Text style={styles.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (allQuestions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>No Questions Available</Text>
        <Text style={styles.body}>The questions table is currently empty.</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={loadQuestions}>
          <Text style={styles.btnText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isCompleted = currentIndex >= filteredQuestions.length;
  const currentQ = filteredQuestions[currentIndex];

  return (
    <SafeAreaView style={styles.wrapper}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Top Controls: Timer Mode Toggle */}
        <View style={styles.topBar}>
          <View style={styles.accountInfo}>
            <Text style={styles.appTitle}>Sangarya IT Quiz</Text>
            <Text style={styles.accountLabel}>{session?.user?.email ?? 'Guest mode'}</Text>
          </View>
          {session ? <TouchableOpacity style={styles.signOutButton} onPress={signOut}><Text style={styles.signOutText}>Sign out</Text></TouchableOpacity> : null}
          <TouchableOpacity
            style={[styles.modeToggle, isTimedMode ? styles.modeTimed : styles.modeUntimed]}
            onPress={toggleTimerMode}
          >
            <Text style={[styles.modeToggleText, isTimedMode ? styles.modeTimedText : styles.modeUntimedText]}>
              {isTimedMode ? '⏱ 30s Timer: ON' : '♾️ No Timer'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Category Filter Bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trackScroll}
        >
          {tracks.map((track) => {
            const active = selectedTrack === track;
            return (
              <TouchableOpacity
                key={track}
                style={[styles.trackPill, active && styles.trackPillActive]}
                onPress={() => handleTrackChange(track)}
              >
                <Text style={[styles.trackPillText, active && styles.trackPillTextActive]}>
                  {track}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>Difficulty</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackScroll}>
            {['All', 'Easy', 'Medium', 'Hard'].map((difficulty) => {
              const active = selectedDifficulty === difficulty;
              return (
                <TouchableOpacity key={difficulty} style={[styles.trackPill, active && styles.trackPillActive]} onPress={() => handleDifficultyChange(difficulty)}>
                  <Text style={[styles.trackPillText, active && styles.trackPillTextActive]}>{difficulty}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={styles.filterLabel}>Level</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackScroll}>
            {['All', 'Foundation', 'Intermediate', 'Advanced'].map((level) => {
              const active = selectedLevel === level;
              return (
                <TouchableOpacity key={level} style={[styles.trackPill, active && styles.trackPillActive]} onPress={() => handleLevelChange(level)}>
                  <Text style={[styles.trackPillText, active && styles.trackPillTextActive]}>{level}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {isCompleted ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Track Completed! 🎉</Text>
            <Text style={styles.scoreText}>
              Score ({selectedTrack}): {score} / {filteredQuestions.length}
            </Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={restartQuiz}>
              <Text style={styles.btnText}>Practice Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.badgeRow}>
              <Text style={styles.badge}>{currentQ.track}</Text>
              <Text style={styles.metaBadge}>{currentQ.difficulty}</Text>
              <Text style={styles.metaBadge}>{currentQ.level}</Text>
              {isTimedMode ? (
                <Text style={[styles.timerText, timeLeft <= 10 && styles.timerWarning]}>
                  ⏱ {timeLeft}s
                </Text>
              ) : (
                <Text style={styles.untimedBadge}>Practice Mode</Text>
              )}
              <Text style={styles.progress}>
                {currentIndex + 1} / {filteredQuestions.length}
              </Text>
            </View>

            {isTimedMode && timeLeft === 0 && selectedOption === null && (
              <Text style={styles.timeoutBanner}>Time's up! Review the correct answer below:</Text>
            )}

            <Text style={styles.questionText}>{currentQ.question_text}</Text>

            {currentQ.options.map((option, idx) => {
              let optionStyle: any = styles.optionCard;
              if (showExplanation) {
                if (idx === currentQ.correct_index) {
                  optionStyle = [styles.optionCard, styles.correctCard];
                } else if (idx === selectedOption) {
                  optionStyle = [styles.optionCard, styles.wrongCard];
                }
              }

              return (
                <TouchableOpacity
                  key={idx}
                  style={optionStyle}
                  onPress={() => handleSelect(idx)}
                  disabled={showExplanation || (isTimedMode && timeLeft === 0)}
                >
                  <Text style={styles.optionLabel}>
                    {String.fromCharCode(65 + idx)}. {option}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {showExplanation && (
              <View style={styles.explanationBox}>
                <Text style={styles.explanationTitle}>Explanation</Text>
                <Text style={styles.explanationText}>{currentQ.explanation}</Text>
                <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
                  <Text style={styles.btnText}>Next Question ➡️</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flexGrow: 1, padding: 16, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  topBar: {
    width: '100%',
    maxWidth: 540,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  appTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  accountInfo: { flex: 1 },
  accountLabel: { fontSize: 11, color: '#64748B', marginTop: 2 },
  signOutButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: '#FEE2E2', marginRight: 8 },
  signOutText: { color: '#B91C1C', fontSize: 11, fontWeight: '700' },
  authContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, width: '100%' },
  authTitle: { fontSize: 28, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  authSubtitle: { fontSize: 15, color: '#64748B', marginBottom: 32, textAlign: 'center' },
  guestButton: { marginTop: 14, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', width: '100%', maxWidth: 360, alignItems: 'center' },
  guestButtonText: { color: '#334155', fontSize: 15, fontWeight: '700' },
  authError: { color: '#DC2626', textAlign: 'center', marginTop: 14 },
  authFootnote: { color: '#94A3B8', textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 28, maxWidth: 340 },
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  modeTimed: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  modeUntimed: { backgroundColor: '#E0F2FE', borderColor: '#0284C7' },
  modeToggleText: { fontSize: 12, fontWeight: '700' },
  modeTimedText: { color: '#B45309' },
  modeUntimedText: { color: '#0369A1' },
  trackScroll: { paddingVertical: 10, gap: 8, maxWidth: 540 },
  filterGroup: { width: '100%', maxWidth: 540, marginBottom: 8 },
  filterLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 4 },
  trackPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
    marginRight: 8,
  },
  trackPillActive: { backgroundColor: '#4F46E5' },
  trackPillText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  trackPillTextActive: { color: '#FFFFFF' },
  card: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    marginTop: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  badge: {
    backgroundColor: '#EEF2FF',
    color: '#4F46E5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontWeight: '600',
    fontSize: 12,
  },
  metaBadge: { backgroundColor: '#F1F5F9', color: '#475569', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, fontWeight: '600', fontSize: 11 },
  timerText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  timerWarning: { color: '#EF4444' },
  untimedBadge: { fontSize: 12, fontWeight: '600', color: '#0284C7' },
  progress: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  timeoutBanner: {
    backgroundColor: '#FEF2F2',
    color: '#DC2626',
    padding: 8,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  questionText: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 20, lineHeight: 26 },
  optionCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  correctCard: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  wrongCard: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  optionLabel: { fontSize: 15, color: '#334155', fontWeight: '500' },
  explanationBox: { marginTop: 16, padding: 16, backgroundColor: '#F1F5F9', borderRadius: 10 },
  explanationTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  explanationText: { fontSize: 14, color: '#475569', lineHeight: 20 },
  nextBtn: {
    marginTop: 16,
    backgroundColor: '#4F46E5',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimary: {
    marginTop: 20,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  heading: { fontSize: 22, fontWeight: '700', color: '#0F172A', marginBottom: 8, textAlign: 'center' },
  scoreText: { fontSize: 18, color: '#475569', marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 14, color: '#64748B', textAlign: 'center' },
});