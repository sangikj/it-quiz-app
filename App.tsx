import React, { useState, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  View,
  Text,
  Alert,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  TextInput,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from './lib/supabase';

interface AnswerRecord {
  question_id: string;
  selected_index: number | null;
  correct_index: number;
  is_correct: boolean;
  time_taken_seconds: number;
}

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

function AppContent() {
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
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [quizStartedAt, setQuizStartedAt] = useState(Date.now());
  const [quizStatus, setQuizStatus] = useState<'completed' | 'ended' | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const savedAttemptRef = useRef(false);

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

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      if (!session?.user?.id) { setDisplayName(''); return; }
      const { data } = await supabase.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
      if (active) setDisplayName(data?.display_name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
    }
    void loadProfile();
    return () => { active = false; };
  }, [session?.user?.id]);

  async function saveProfile() {
    if (!session?.user?.id) return;
    setProfileSaving(true); setProfileMessage(null);
    const { error } = await supabase.from('profiles').upsert({ id: session.user.id, display_name: displayName.trim(), updated_at: new Date().toISOString() });
    setProfileSaving(false);
    setProfileMessage(error ? 'Could not update your profile: ' + error.message : 'Profile updated.');
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
      const question = filteredQuestions[currentIndex];
      setAnswers((previous) => previous.some((answer) => answer.question_id === question.id)
        ? previous
        : [...previous, {
            question_id: question.id,
            selected_index: null,
            correct_index: question.correct_index,
            is_correct: false,
            time_taken_seconds: TIME_LIMIT,
          }]);
    }
  }, [isTimedMode, loading, filteredQuestions, currentIndex, timeLeft, selectedOption, showExplanation]);

  const handleTrackChange = (track: string) => {
    setSelectedTrack(track);
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowExplanation(false);
    setScore(0);
    setTimeLeft(TIME_LIMIT);
    setAnswers([]);
    setQuizStartedAt(Date.now());
    setQuizStatus(null);
    setSaveMessage(null);
    savedAttemptRef.current = false;
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
    const question = filteredQuestions[currentIndex];
    setAnswers((previous) => previous.some((answer) => answer.question_id === question.id)
      ? previous
      : [...previous, {
          question_id: question.id,
          selected_index: index,
          correct_index: question.correct_index,
          is_correct: index === question.correct_index,
          time_taken_seconds: isTimedMode ? Math.max(0, TIME_LIMIT - timeLeft) : 0,
        }]);
    if (index === question.correct_index) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNext = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    setTimeLeft(TIME_LIMIT);
    setCurrentIndex((prev) => prev + 1);
  };

  const saveAttempt = async (status: 'completed' | 'ended') => {
    if (!session?.user?.id || savedAttemptRef.current || isSavingAttempt) return;
    savedAttemptRef.current = true;
    setIsSavingAttempt(true);
    setSaveMessage(null);
    try {
      const total = filteredQuestions.length;
      const { data: attempt, error: attemptError } = await supabase.from('quiz_attempts').insert({
        user_id: session.user.id,
        track: selectedTrack === 'All' ? null : selectedTrack,
        difficulty: selectedDifficulty === 'All' ? null : selectedDifficulty,
        level: selectedLevel === 'All' ? null : selectedLevel,
        mode: isTimedMode ? 'timed' : 'practice',
        total_questions: total,
        correct_answers: score,
        score_percentage: total > 0 ? Number(((score / total) * 100).toFixed(2)) : 0,
        duration_seconds: Math.max(0, Math.floor((Date.now() - quizStartedAt) / 1000)),
        status,
      }).select('id').single();
      if (attemptError) throw attemptError;
      if (answers.length > 0) {
        const rows = answers.map((answer) => ({ ...answer, attempt_id: attempt.id, user_id: session.user.id }));
        const { error: responseError } = await supabase.from('quiz_responses').insert(rows);
        if (responseError) throw responseError;
      }
      setSaveMessage('Quiz result saved to your account.');
    } catch (error) {
      savedAttemptRef.current = false;
      setSaveMessage(error instanceof Error ? 'Could not save quiz: ' + error.message : 'Could not save quiz.');
    } finally {
      setIsSavingAttempt(false);
    }
  };

  useEffect(() => {
    if (currentIndex >= filteredQuestions.length && filteredQuestions.length > 0 && !quizStatus) {
      setQuizStatus('completed');
      if (session?.user?.id) void saveAttempt('completed');
    }
  }, [currentIndex, filteredQuestions.length, quizStatus, session?.user?.id]);

  const endQuiz = () => {
    Alert.alert('End quiz?', 'Your current score will be saved as a partial attempt.', [
      { text: 'Continue Quiz', style: 'cancel' },
      { text: 'End Quiz', style: 'destructive', onPress: () => {
        setQuizStatus('ended');
        if (session?.user?.id) void saveAttempt('ended');
        else setSaveMessage('Guest quiz ended. Sign in to save quiz history.');
      } },
    ]);
  };

  const restartQuiz = () => {
    setAnswers([]);
    setQuizStartedAt(Date.now());
    setQuizStatus(null);
    setSaveMessage(null);
    savedAttemptRef.current = false;
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

  if (showAccount) {
    const provider = session?.user?.app_metadata?.provider || 'Google';
    return (
      <SafeAreaView style={styles.wrapper}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" translucent={false} />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.accountScreen}>
            <TouchableOpacity onPress={() => { setShowAccount(false); setProfileMessage(null); }} style={styles.backButton}><Text style={styles.backButtonText}>‹  Back to quiz</Text></TouchableOpacity>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(displayName || 'G').trim().charAt(0).toUpperCase()}</Text></View>
            <Text style={styles.accountScreenTitle}>Account details</Text>
            <View style={[styles.authStatusBadge, { alignSelf: 'center', marginBottom: 18 }]}><View style={[styles.authStatusDot, { backgroundColor: session ? '#16A34A' : '#D97706' }]} /><Text style={styles.authStatusText}>{session ? 'Signed in with Google' : 'Guest mode'}</Text></View>
            <Text style={styles.filterLabel}>Display name</Text>
            <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Enter your name" style={styles.profileInput} editable={!!session} />
            <Text style={styles.filterLabel}>Email address</Text>
            <Text style={styles.accountDetailValue}>{session?.user?.email || 'Not linked to an account'}</Text>
            <Text style={styles.filterLabel}>Sign-in method</Text>
            <Text style={styles.accountDetailValue}>{session ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Guest (no account)'}</Text>
            {session?.user?.created_at ? <><Text style={styles.filterLabel}>Account created</Text><Text style={styles.accountDetailValue}>{new Date(session.user.created_at).toLocaleDateString()}</Text></> : null}
            {profileMessage ? <Text style={styles.saveMessage}>{profileMessage}</Text> : null}
            {session ? <TouchableOpacity style={styles.btnPrimary} onPress={saveProfile} disabled={profileSaving}>{profileSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>Save profile</Text>}</TouchableOpacity> : <TouchableOpacity style={styles.btnPrimary} onPress={() => { setShowAccount(false); void signInWithGoogle(); }}><Text style={styles.btnText}>Sign in with Google to save progress</Text></TouchableOpacity>}
            {session ? <TouchableOpacity style={styles.signOutButton} onPress={signOut}><Text style={styles.signOutText}>Sign out</Text></TouchableOpacity> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
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
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" translucent={false} />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Top Controls: Timer Mode Toggle */}
        <View style={styles.topBar}>
          <View style={styles.headerIdentity}>
            <View style={styles.accountInfo}>
              <Text style={styles.appTitle}>Sangarya IT Quiz</Text>
              <Text numberOfLines={1} style={styles.accountLabel}>{session?.user?.email ?? 'Practice without an account'}</Text>
              <View style={styles.authStatusBadge}><View style={[styles.authStatusDot, { backgroundColor: session ? '#16A34A' : '#D97706' }]} /><Text style={styles.authStatusText}>{session ? 'Signed in with Google' : 'Guest mode'}</Text></View>
            </View>
            <View style={styles.headerActions}>
              {!isCompleted && !quizStatus ? <TouchableOpacity style={styles.headerEndButton} onPress={endQuiz} accessibilityRole="button"><Text style={styles.headerEndButtonText}>End Quiz</Text></TouchableOpacity> : null}
              <TouchableOpacity style={styles.accountButton} onPress={() => setShowAccount(true)}><Text style={styles.accountButtonText}>Account</Text></TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.modeToggle, isTimedMode ? styles.modeTimed : styles.modeUntimed]}
            onPress={toggleTimerMode}
            accessibilityRole="switch"
            accessibilityState={{ checked: isTimedMode }}
          >
            <Text style={[styles.modeToggleText, isTimedMode ? styles.modeTimedText : styles.modeUntimedText]}>
              {isTimedMode ? '⏱ 30s Timer  ● ON' : '♾️ No Timer  ○ OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Filters stay compact while answering; expand only when the user needs to change them. */}
        <View style={styles.filterPanel}>
          <TouchableOpacity style={styles.filterSummaryButton} onPress={() => { setFiltersExpanded((value) => !value); setOpenFilter(null); }} accessibilityRole="button" accessibilityState={{ expanded: filtersExpanded }}>
            <Text style={styles.filterSummaryText}>{selectedTrack === 'All' && selectedDifficulty === 'All' && selectedLevel === 'All' ? 'Filters (All)' : `Filters · ${selectedTrack === 'All' ? 'All topics' : selectedTrack} · ${selectedDifficulty} · ${selectedLevel}`}</Text>
            <Text style={styles.dropdownChevron}>{filtersExpanded ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {filtersExpanded ? <View style={styles.expandedFilters}>
            {[
              { key: 'category', label: 'Category', value: selectedTrack, options: tracks, onChange: handleTrackChange },
              { key: 'difficulty', label: 'Difficulty', value: selectedDifficulty, options: ['All', 'Easy', 'Medium', 'Hard'], onChange: handleDifficultyChange },
              { key: 'level', label: 'Level', value: selectedLevel, options: ['All', 'Foundation', 'Intermediate', 'Advanced'], onChange: handleLevelChange },
            ].map((filter) => (
              <View key={filter.key} style={styles.dropdownWrap}>
                <Text style={styles.filterLabel}>{filter.label}</Text>
                <TouchableOpacity style={styles.dropdownButton} onPress={() => setOpenFilter(openFilter === filter.key ? null : filter.key)} activeOpacity={0.8}>
                  <Text numberOfLines={1} style={styles.dropdownValue}>{filter.value === 'All' ? (filter.key === 'category' ? 'All Topics' : 'All') : filter.value}</Text>
                  <Text style={styles.dropdownChevron}>{openFilter === filter.key ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {openFilter === filter.key ? <View style={styles.dropdownMenu}><ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                  {filter.options.map((option) => <TouchableOpacity key={option} style={[styles.dropdownOption, filter.value === option && styles.dropdownOptionActive]} onPress={() => { filter.onChange(option); setOpenFilter(null); }}>
                    <Text style={[styles.dropdownOptionText, filter.value === option && styles.dropdownOptionTextActive]}>{option === 'All' && filter.key === 'category' ? 'All Topics' : option}</Text>
                    {filter.value === option ? <Text style={styles.dropdownCheck}>✓</Text> : null}
                  </TouchableOpacity>)}
                </ScrollView></View> : null}
              </View>
            ))}
            <TouchableOpacity onPress={() => { handleTrackChange('All'); handleDifficultyChange('All'); handleLevelChange('All'); setOpenFilter(null); }} style={styles.clearFilters}><Text style={styles.clearFiltersText}>Clear filters</Text></TouchableOpacity>
          </View> : null}
        </View>
        {isCompleted || quizStatus === 'ended' ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{quizStatus === 'ended' ? 'Quiz Ended' : 'Track Completed! 🎉'}</Text>
            <Text style={styles.scoreText}>
              Score ({selectedTrack}): {score} / {filteredQuestions.length}
            </Text>
            {saveMessage ? <Text style={styles.saveMessage}>{saveMessage}</Text> : null}
            {isSavingAttempt ? <ActivityIndicator color="#4F46E5" /> : null}
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
              let letterStyle: any = styles.optionLetter;
              let letterTextStyle: any = styles.optionLetterText;
              if (showExplanation) {
                if (idx === currentQ.correct_index) {
                  optionStyle = [styles.optionCard, styles.correctCard];
                  letterStyle = [styles.optionLetter, styles.correctLetter];
                  letterTextStyle = [styles.optionLetterText, styles.correctLetterText];
                } else if (idx === selectedOption) {
                  optionStyle = [styles.optionCard, styles.wrongCard];
                  letterStyle = [styles.optionLetter, styles.wrongLetter];
                  letterTextStyle = [styles.optionLetterText, styles.wrongLetterText];
                }
              }

              return (
                <TouchableOpacity
                  key={idx}
                  style={optionStyle}
                  onPress={() => handleSelect(idx)}
                  disabled={showExplanation || (isTimedMode && timeLeft === 0)}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel={`Option ${String.fromCharCode(65 + idx)}: ${option}`}
                >
                  <View style={letterStyle}>
                    <Text style={letterTextStyle}>{String.fromCharCode(65 + idx)}</Text>
                  </View>
                  <Text style={styles.optionLabel}>{option}</Text>
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

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  topBar: {
    width: '100%',
    maxWidth: 540,
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  headerIdentity: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  appTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  accountInfo: { flex: 1, minWidth: 0 },
  accountLabel: { fontSize: 12, color: '#64748B', marginTop: 3 },
  signOutButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#FEE2E2' },
  signOutText: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },
  endQuizButton: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FEE2E2', borderRadius: 10, marginBottom: 8 },
  endQuizText: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },
  saveMessage: { color: '#475569', textAlign: 'center', marginVertical: 10, fontSize: 12 },
  authContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, width: '100%' },
  authTitle: { fontSize: 28, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  authSubtitle: { fontSize: 15, color: '#64748B', marginBottom: 32, textAlign: 'center' },
  guestButton: { marginTop: 14, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', width: '100%', maxWidth: 360, alignItems: 'center' },
  guestButtonText: { color: '#334155', fontSize: 15, fontWeight: '700' },
  authError: { color: '#DC2626', textAlign: 'center', marginTop: 14 },
  authFootnote: { color: '#94A3B8', textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 28, maxWidth: 340 },
  modeToggle: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modeTimed: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  modeUntimed: { backgroundColor: '#E0F2FE', borderColor: '#0284C7' },
  modeToggleText: { fontSize: 13, fontWeight: '700' },
  modeTimedText: { color: '#B45309' },
  modeUntimedText: { color: '#0369A1' },
  horizontalFilter: { width: '100%', maxWidth: 540, flexGrow: 0, height: 56 },
  trackScroll: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 2, gap: 8 },
  filterPanel: { width: '100%', maxWidth: 540, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  filterSummaryButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  filterSummaryText: { flex: 1, color: '#334155', fontSize: 13, fontWeight: '700' },
  expandedFilters: { gap: 8, paddingHorizontal: 6, paddingBottom: 4 },
  
  dropdownWrap: { width: '100%', zIndex: 2 },
  dropdownButton: { minHeight: 48, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC' },
  dropdownValue: { flex: 1, color: '#1E293B', fontSize: 14, fontWeight: '600' },
  dropdownChevron: { color: '#64748B', fontSize: 12, marginLeft: 10 },
  dropdownMenu: { marginTop: 4, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, backgroundColor: '#FFFFFF', overflow: 'hidden', elevation: 4 },
  dropdownOption: { minHeight: 42, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dropdownOptionActive: { backgroundColor: '#EEF2FF' },
  dropdownOptionText: { color: '#334155', fontSize: 14 },
  dropdownOptionTextActive: { color: '#4338CA', fontWeight: '700' },
  dropdownCheck: { color: '#4F46E5', fontWeight: '800' },
  clearFilters: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 2 },
  clearFiltersText: { color: '#4F46E5', fontWeight: '700', fontSize: 12 },
  authStatusBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 5, gap: 6 },
  authStatusDot: { width: 7, height: 7, borderRadius: 4 },
  authStatusText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerEndButton: { backgroundColor: '#FEE2E2', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 9 },
  headerEndButtonText: { color: '#B91C1C', fontSize: 11, fontWeight: '800' },
  accountButton: { backgroundColor: '#EEF2FF', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 },
  accountButtonText: { color: '#4338CA', fontSize: 13, fontWeight: '700' },
  accountScreen: { width: '100%', maxWidth: 540, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 22, marginTop: 8, elevation: 2 },
  backButton: { alignSelf: 'flex-start', marginBottom: 22 },
  backButtonText: { color: '#4F46E5', fontSize: 14, fontWeight: '700' },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E0E7FF', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  profileAvatarText: { color: '#4338CA', fontSize: 30, fontWeight: '800' },
  accountScreenTitle: { color: '#0F172A', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  profileInput: { minHeight: 46, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, color: '#0F172A', marginBottom: 12 },
  accountDetailValue: { color: '#334155', fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#F8FAFC', borderRadius: 10, marginBottom: 12 },
  filterGroup: { width: '100%', maxWidth: 540, marginBottom: 12 },
  filterLabel: { fontSize: 13, fontWeight: '700', color: '#64748B', marginTop: 8, marginBottom: 2 },
  categoryTab: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 11,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  categoryTabActive: { backgroundColor: '#312E81', borderColor: '#312E81' },
  categoryTabText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  categoryTabTextActive: { color: '#FFFFFF' },
  categoryActiveMark: { height: 3, width: 24, borderRadius: 2, backgroundColor: '#C4B5FD', marginTop: 5 },
  difficultyChip: { minHeight: 38, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginRight: 8 },
  difficultyChipActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  easyActive: { backgroundColor: '#15803D', borderColor: '#15803D' },
  mediumActive: { backgroundColor: '#D97706', borderColor: '#D97706' },
  hardActive: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  difficultyText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  difficultyTextActive: { color: '#FFFFFF' },
  levelChip: { minHeight: 40, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginRight: 8 },
  levelChipActive: { backgroundColor: '#EDE9FE', borderColor: '#7C3AED' },
  levelText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  levelTextActive: { color: '#6D28D9' },
  card: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
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
    marginBottom: 10,
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
  questionText: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 12, lineHeight: 22 },
  optionCard: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  correctCard: { borderColor: '#059669', backgroundColor: '#ECFDF5' },
  wrongCard: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  optionLetter: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  optionLetterText: { fontSize: 14, fontWeight: '800', color: '#475569' },
  correctLetter: { backgroundColor: '#059669' },
  correctLetterText: { color: '#FFFFFF' },
  wrongLetter: { backgroundColor: '#DC2626' },
  wrongLetterText: { color: '#FFFFFF' },
  optionLabel: { flex: 1, flexShrink: 1, fontSize: 15, lineHeight: 22, color: '#334155', fontWeight: '500' },
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