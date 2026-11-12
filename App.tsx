import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, SafeAreaView, ScrollView } from 'react-native';
import { supabase } from './lib/supabase';

interface Question {
  id: string;
  track: string;
  question_text: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQuestions();
  }, []);

  async function loadQuestions() {
    setLoading(true);
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .limit(10);

    if (error) {
      console.error('Supabase error:', error.message);
    } else if (data) {
      setQuestions(data);
    }
    setLoading(false);
  }

  const handleSelect = (index: number) => {
    if (selectedOption !== null) return;
    setSelectedOption(index);
    setShowExplanation(true);
    if (index === questions[currentIndex].correct_index) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNext = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    setCurrentIndex((prev) => prev + 1);
  };

  const restartQuiz = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    setCurrentIndex(0);
    setScore(0);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={{ marginTop: 12, color: '#64748B' }}>Connecting to Supabase...</Text>
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>No Questions Found</Text>
        <Text style={styles.body}>Check that your .env.local keys are saved and your Supabase table has data.</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={loadQuestions}>
          <Text style={styles.btnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (currentIndex >= questions.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Quiz Completed! 🎉</Text>
        <Text style={styles.scoreText}>Your Score: {score} / {questions.length}</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={restartQuiz}>
          <Text style={styles.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentQ = questions[currentIndex];

  return (
    <SafeAreaView style={styles.wrapper}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <Text style={styles.badge}>{currentQ.track}</Text>
            <Text style={styles.progress}>Question {currentIndex + 1} of {questions.length}</Text>
          </View>

          <Text style={styles.questionText}>{currentQ.question_text}</Text>

          {currentQ.options.map((option, idx) => {
            let optionStyle: any = styles.optionCard;
            if (selectedOption !== null) {
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
                disabled={selectedOption !== null}
              >
                <Text style={styles.optionLabel}>{String.fromCharCode(65 + idx)}. {option}</Text>
              </TouchableOpacity>
            );
          })}

          {showExplanation && (
            <View style={styles.explanationBox}>
              <Text style={styles.explanationTitle}>Explanation</Text>
              <Text style={styles.explanationText}>{currentQ.explanation}</Text>
              <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
                <Text style={styles.btnText}>Next ➡️</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flexGrow: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 540, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  badge: { backgroundColor: '#EEF2FF', color: '#4F46E5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, fontWeight: '600', fontSize: 12 },
  progress: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  questionText: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 20, lineHeight: 26 },
  optionCard: { padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', marginBottom: 12, backgroundColor: '#FFFFFF' },
  correctCard: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  wrongCard: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  optionLabel: { fontSize: 15, color: '#334155', fontWeight: '500' },
  explanationBox: { marginTop: 16, padding: 16, backgroundColor: '#F1F5F9', borderRadius: 10 },
  explanationTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  explanationText: { fontSize: 14, color: '#475569', lineHeight: 20 },
  nextBtn: { marginTop: 16, backgroundColor: '#4F46E5', padding: 14, borderRadius: 8, alignItems: 'center' },
  btnPrimary: { marginTop: 20, backgroundColor: '#4F46E5', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  btnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  heading: { fontSize: 22, fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  scoreText: { fontSize: 18, color: '#475569', marginBottom: 12 },
  body: { fontSize: 14, color: '#64748B', textAlign: 'center' }
});