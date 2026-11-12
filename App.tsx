import React, { useState, useEffect } from 'react';
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
}

const TIME_LIMIT = 30; // seconds per question in Timed mode

export default function App() {
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>('All');
  const [isTimedMode, setIsTimedMode] = useState<boolean>(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);

  useEffect(() => {
    loadQuestions();
  }, []);

  async function loadQuestions() {
    setLoading(true);
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error.message);
    } else if (data) {
      setAllQuestions(data);
    }
    setLoading(false);
  }

  // Derive unique categories dynamically from Supabase rows
  const tracks = ['All', ...Array.from(new Set(allQuestions.map((q) => q.track).filter(Boolean)))];

  // Filter questions by active category
  const filteredQuestions =
    selectedTrack === 'All'
      ? allQuestions
      : allQuestions.filter((q) => q.track === selectedTrack);

  // Countdown timer logic (only runs when isTimedMode is true)
  useEffect(() => {
    if (!isTimedMode) return;
    if (loading || filteredQuestions.length === 0 || currentIndex >= filteredQuestions.length) return;
    if (selectedOption !== null || showExplanation) return;

    if (timeLeft === 0) {
      setShowExplanation(true); // Time's up: reveal answer automatically
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isTimedMode, timeLeft, selectedOption, showExplanation, currentIndex, filteredQuestions.length, loading]);

  const handleTrackChange = (track: string) => {
    setSelectedTrack(track);
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowExplanation(false);
    setScore(0);
    setTimeLeft(TIME_LIMIT);
  };

  const toggleTimerMode = () => {
    setIsTimedMode((prev) => !prev);
    setTimeLeft(TIME_LIMIT);
  };

  const handleSelect = (index: number) => {
    if (selectedOption !== null || showExplanation) return;
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={{ marginTop: 12, color: '#64748B' }}>Loading Interview Questions...</Text>
      </View>
    );
  }

  if (allQuestions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>No Questions Found</Text>
        <Text style={styles.body}>Check your internet connection or Supabase database.</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={loadQuestions}>
          <Text style={styles.btnText}>Retry</Text>
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
          <Text style={styles.appTitle}>Sangarya IT Quiz</Text>
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
                  disabled={showExplanation}
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