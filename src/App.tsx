/**
 * AI Car Mechanic - Main Application Entry
 *
 * Modern, responsive virtual automotive technician web application.
 * Built with a decoupled service layer ready to connect to a Django REST backend.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowRight,
  Camera,
  ClipboardCheck,
  MessageCircle,
} from 'lucide-react';
import {
  ChatSession,
  ChatMessage,
  DiagnosticReport,
  MediaAttachment,
  MechanicBooking,
  VehicleProfile,
} from './types/mechanic';
import { apiClient, DEFAULT_VEHICLE } from './services/apiClient';
import { DiagnosticPreset } from './data/samplePresets';

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { MediaUploaderModal } from './components/MediaUploaderModal';
import { BookingModal } from './components/BookingModal';
import { VehicleModal } from './components/VehicleModal';
import { ApiSimulatorModal } from './components/ApiSimulatorModal';
import { PresetsModal } from './components/PresetsModal';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [incomingAttachment, setIncomingAttachment] = useState<MediaAttachment | null>(null);

  // Modals state
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState<boolean>(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState<boolean>(false);
  const [isApiSimulatorOpen, setIsApiSimulatorOpen] = useState<boolean>(false);
  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState<boolean>(false);

  // Diagnosis target for booking
  const [targetDiagnosis, setTargetDiagnosis] = useState<DiagnosticReport | null>(null);

  // Load initial sessions from service layer
  const loadSessions = useCallback(async () => {
    try {
      const data = await apiClient.getSessions();
      setSessions(data);
      if (data.length > 0 && !currentSessionId) {
        setCurrentSessionId(data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load sessions', err);
      setError(err.message || 'Unable to retrieve diagnostic history.');
    } finally {
      setIsInitializing(false);
    }
  }, [currentSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Current active session
  const currentSession = sessions.find((s) => s.id === currentSessionId) || sessions[0] || null;

  // Handler: Start New Diagnostic Session
  const handleNewSession = async (
    vehicle: VehicleProfile = currentSession?.vehicle || DEFAULT_VEHICLE,
    title = 'New Car Diagnostic'
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const newSession = await apiClient.createSession(vehicle, title);
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setIsSidebarOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to initialize new consultation session.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Delete Session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await apiClient.deleteSession(sessionId);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      if (currentSessionId === sessionId) {
        setCurrentSessionId(remaining[0]?.id || '');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to remove session.');
    }
  };

  // Handler: Update Vehicle Details
  const handleSaveVehicle = async (vehicle: VehicleProfile) => {
    if (!currentSession) return;
    try {
      const updated = await apiClient.updateVehicle(currentSession.id, vehicle);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err: any) {
      setError(err.message || 'Failed to update vehicle specifications.');
    }
  };

  // Handler: Send Message
  const handleSendMessage = async (text: string, attachments: MediaAttachment[] = []) => {
    if (!currentSession) return;

    setIsLoading(true);
    setError(null);

    // Optimistically push user message to UI immediately
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
      status: 'sending',
    };

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === currentSession.id) {
          return {
            ...s,
            messages: [...s.messages, tempUserMsg],
          };
        }
        return s;
      })
    );

    try {
      const result = await apiClient.sendMessage(currentSession.id, text, attachments);
      const backendSessionId = String(result.conversationId);
      setCurrentSessionId(backendSessionId);

      // Update session with confirmed messages from API
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSession.id) {
            // Replace optimistic message and append assistant response
            const cleaned = s.messages.filter((m) => m.id !== tempUserMsg.id);
            return {
              ...s,
              id: backendSessionId,
              title: s.title === 'New Car Diagnostic' && text ? `${text.slice(0, 32)}...` : s.title,
              messages: [...cleaned, result.userMessage, result.assistantMessage],
              updatedAt: new Date().toISOString(),
            };
          }
          return s;
        })
      );
    } catch (err: any) {
      console.error('Send message failed', err);
      setError(err.message || 'Service communication error. Please retry.');

      // Mark the temp message with error status
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSession.id) {
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === tempUserMsg.id
                  ? { ...m, status: 'error', errorMessage: err.message }
                  : m
              ),
            };
          }
          return s;
        })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestDiagnosis = async () => {
    if (!currentSession) return;
    setIsLoading(true);
    setError(null);
    try {
      const diagnosis = await apiClient.requestDiagnosis(currentSession.id);
      const diagnosisMessage: ChatMessage = {
        id: `diagnosis-${Date.now()}`,
        sender: 'assistant',
        content: 'The backend diagnostic assessment is ready below.',
        timestamp: new Date().toISOString(),
        diagnosis,
        status: 'sent',
      };
      setSessions((prev) => prev.map((session) => (
        session.id === currentSession.id
          ? { ...session, messages: [...session.messages, diagnosisMessage], latestDiagnosis: diagnosis, isDiagnosed: true }
          : session
      )));
    } catch (err: any) {
      setError(err.message || 'Unable to generate a diagnosis.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Retry Failed Message
  const handleRetryMessage = async (failedMsg: ChatMessage) => {
    // Remove the failed message and re-send
    if (!currentSession) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === currentSession.id) {
          return {
            ...s,
            messages: s.messages.filter((m) => m.id !== failedMsg.id),
          };
        }
        return s;
      })
    );
    await handleSendMessage(failedMsg.content, failedMsg.attachments || []);
  };

  // Handler: Open Booking Flow with Diagnosis
  const handleBookDiagnosis = (diagnosis: DiagnosticReport) => {
    setTargetDiagnosis(diagnosis);
    setIsBookingModalOpen(true);
  };

  const handleStartBooking = () => {
    const diagnosis = currentSession?.latestDiagnosis;
    if (!diagnosis) {
      setError('Complete a backend diagnosis before booking a mechanic.');
      document.getElementById('diagnose')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    handleBookDiagnosis(diagnosis);
  };

  // Handler: Booking Confirmed Success
  const handleBookingSuccess = (booking: MechanicBooking) => {
    if (!currentSession) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === currentSession.id) {
          return {
            ...s,
            booking,
          };
        }
        return s;
      })
    );
  };

  // Handler: Load Preset Demo Scenario
  const handleSelectPreset = async (preset: DiagnosticPreset) => {
    setIsLoading(true);
    setError(null);
    try {
      // Create fresh consultation session with preset vehicle and title
      const newSession = await apiClient.createSession(preset.vehicle, preset.title);
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setIsSidebarOpen(false);

      // Automatically dispatch initial user message with attached media assets
      const result = await apiClient.sendMessage(
        newSession.id,
        preset.initialUserMessage,
        preset.sampleMedia || []
      );

      // Reload fresh session state from client
      const updated = await apiClient.getSession(String(result.conversationId));
      if (updated) {
        setSessions((prev) => prev.map((s) => (
          s.id === newSession.id || s.id === updated.id ? updated : s
        )));
        setCurrentSessionId(updated.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize demo scenario.');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state placeholder
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-4">
        <div className="w-12 h-12 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-lg font-bold text-white">Starting AI Car Mechanic...</h2>
        <p className="text-xs text-slate-400 mt-1">
          Initializing ASE Master Technician diagnostic service layer
        </p>
      </div>
    );
  }

  const activeVehicle: VehicleProfile = currentSession?.vehicle || DEFAULT_VEHICLE;
  const activeDiagnosis: DiagnosticReport | null = targetDiagnosis || currentSession?.latestDiagnosis || null;

  const scrollToChat = () => document.getElementById('diagnose')?.scrollIntoView({ behavior: 'smooth' });
  const stepItems: Array<[string, typeof MessageCircle, string, string]> = [
    ['01', MessageCircle, 'Describe the problem', 'Tell the mechanic what you hear, feel, smell, or see.'],
    ['02', Camera, 'Share photos or media', 'Upload a dash light, engine detail, or recording of the sound.'],
    ['03', ClipboardCheck, 'Get guided diagnosis', 'Answer relevant follow-up questions and review possible causes.'],
    ['04', ArrowRight, 'Book a mechanic', 'Move from understanding the issue to arranging the next step.'],
  ];

  return (
    <div className="app-shell">
      <Header
        currentSession={currentSession}
        onNewSession={() => handleNewSession()}
        onOpenVehicleModal={() => setIsVehicleModalOpen(true)}
        onOpenApiSimulator={() => setIsApiSimulatorOpen(true)}
        onOpenPresetsModal={() => setIsPresetsModalOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
      />

      <main>
        <section className="hero-section" id="home">
          <div className="hero-copy">
            <p className="eyebrow"><span /> AI-powered vehicle diagnostics</p>
            <h1>Your Car Problem.<br /><em>Diagnosed Smarter.</em></h1>
            <p className="hero-lede">
              Describe the issue, share photos or media, and get guided troubleshooting from your AI mechanic.
            </p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={scrollToChat}>Start Diagnosis <ArrowRight size={17} /></button>
              <button className="button button-secondary" onClick={handleStartBooking}>Book a Mechanic</button>
            </div>
            <div className="hero-note"><span className="status-dot" /> Ready to help with your next drive</div>
          </div>
          <div className="hero-visual">
            <img src="https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=85" alt="Mechanic inspecting a vehicle engine" />
            <div className="hero-chat-preview">
              <div className="preview-top"><span className="preview-avatar"><MessageCircle size={15} /></span><span><strong>AI Mechanic</strong><small>Online · ready to help</small></span><span className="preview-live" /></div>
              <div className="preview-bubble">What symptoms are you noticing?</div>
              <div className="preview-bubble preview-user">A squeal when I brake at low speed.</div>
              <div className="preview-bubble">Tell me when it happens and I’ll narrow down the likely cause.</div>
            </div>
          </div>
        </section>

        <section className="trust-strip">
          <span>Built for the moments when your dashboard leaves you guessing.</span>
          <div><span>CONVERSATIONAL DIAGNOSIS</span><span>MEDIA READY</span><span>MECHANIC HANDOFF</span></div>
        </section>

        <section className="chat-section" id="diagnose">
          <div className="section-heading section-heading-light">
            <div><p className="eyebrow"><span /> The main event</p><h2>Talk to Your AI Mechanic</h2></div>
            <p>Describe what your car is doing. The assistant asks the right questions before suggesting possible causes and next steps.</p>
          </div>
          <div className="chat-workspace">
            <Sidebar
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSelectSession={(id) => setCurrentSessionId(id)}
              onNewSession={() => handleNewSession()}
              onDeleteSession={handleDeleteSession}
              currentVehicle={activeVehicle}
              onOpenVehicleModal={() => setIsVehicleModalOpen(true)}
              onSelectPreset={handleSelectPreset}
            />
            <div className="chat-main-panel">
              <ChatArea
                messages={currentSession?.messages || []}
                vehicle={activeVehicle}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                onBookMechanic={handleBookDiagnosis}
                onOpenMediaModal={() => setIsMediaModalOpen(true)}
                onOpenVehicleModal={() => setIsVehicleModalOpen(true)}
                onRetryMessage={handleRetryMessage}
                onRequestDiagnosis={handleRequestDiagnosis}
                incomingAttachment={incomingAttachment}
                error={error}
                onClearError={() => setError(null)}
                isBooked={!!currentSession?.booking}
              />
            </div>
          </div>
        </section>

        <section className="steps-section" id="how-it-works">
          <div className="section-heading"><div><p className="eyebrow"><span /> A clearer route forward</p><h2>From symptom to next step.</h2></div><p>No guesswork, no jargon wall. Just a guided conversation that turns what you’re noticing into useful action.</p></div>
          <div className="steps-grid">
            {stepItems.map(([number, Icon, title, copy]) => {
              return <div className="step-card" key={number}><span className="step-number">{number}</span><Icon size={22} /><h3>{title}</h3><p>{copy}</p></div>;
            })}
          </div>
        </section>

        <section className="services-section" id="services">
          <div className="section-heading"><div><p className="eyebrow"><span /> One product, four useful moments</p><h2>More than an answer.</h2></div><p>AI Car Mechanic helps you understand the situation before you decide what to do next.</p></div>
          <div className="services-grid">
            {[['AI Car Diagnosis', 'Understand possible causes of your vehicle problem.', '01'], ['Photo Analysis', 'Share a warning light, engine component, tyre, or visible issue.', '02'], ['Guided Troubleshooting', 'Answer relevant questions before receiving a diagnosis.', '03'], ['Mechanic Booking', 'Book a mechanic after understanding the recommended service.', '04']].map(([title, copy, number]) => <article className="service-card" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p><button onClick={scrollToChat} aria-label={`Explore ${title}`}><ArrowRight size={18} /></button></article>)}
          </div>
        </section>

        <section className="about-section" id="about">
          <div className="about-image"><img src="https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=1000&q=85" alt="Automotive engine components" /></div>
          <div className="about-copy"><p className="eyebrow"><span /> Why it exists</p><h2>Technology that helps you understand your car before you visit a mechanic.</h2><p>AI Car Mechanic gives drivers a calmer first step when something feels wrong. The product keeps the conversation practical: listen carefully, ask better questions, explain the likely issue, and create a direct path to service when you need one.</p><div className="benefit-list"><div><strong>Clearer diagnosis</strong><span>Know what the possible issue may be.</span></div><div><strong>Guided questions</strong><span>Get relevant follow-up questions instead of guessing.</span></div><div><strong>Mechanic booking</strong><span>Move from diagnosis to service when needed.</span></div></div></div>
        </section>

        <section className="final-cta" id="book"><div><p className="eyebrow"><span /> Ready when you are</p><h2>Know the problem.<br /><em>Get it fixed.</em></h2><p>Once you’ve understood the likely issue, book a mechanic for the next step.</p></div><button className="button button-primary" onClick={handleStartBooking}>Book a Mechanic <ArrowRight size={17} /></button></section>
      </main>

      <footer className="site-footer"><div><strong>AI Car Mechanic</strong><p>Smart vehicle diagnosis with a direct path to mechanic service.</p></div><nav><a href="#home">Home</a><a href="#diagnose">Diagnose</a><a href="#how-it-works">How It Works</a><a href="#services">Services</a><a href="#book">Book Mechanic</a></nav><span>© 2026 AI Car Mechanic</span></footer>

      <div className="modal-host">

      {/* Vehicle Specifications Modal */}
      <VehicleModal
        isOpen={isVehicleModalOpen}
        onClose={() => setIsVehicleModalOpen(false)}
        currentVehicle={activeVehicle}
        onSaveVehicle={handleSaveVehicle}
      />

      {/* Media Uploader & Microphone Recorder Modal */}
      <MediaUploaderModal
        isOpen={isMediaModalOpen}
        onClose={() => setIsMediaModalOpen(false)}
        onAttachMedia={(attachment) => {
          setIncomingAttachment(attachment);
        }}
      />

      {/* Booking & Work Order Confirmation Modal */}
      <BookingModal
        isOpen={isBookingModalOpen && !!activeDiagnosis}
        onClose={() => setIsBookingModalOpen(false)}
        diagnosis={activeDiagnosis as DiagnosticReport}
        vehicle={activeVehicle}
        conversationId={currentSession?.id}
        onBookingSuccess={handleBookingSuccess}
        existingBooking={currentSession?.booking}
      />

      {/* API Simulator & Django REST Architecture Modal */}
      <ApiSimulatorModal
        isOpen={isApiSimulatorOpen}
        onClose={() => setIsApiSimulatorOpen(false)}
      />

      {/* Interactive Demo Presets Modal */}
      <PresetsModal
        isOpen={isPresetsModalOpen}
        onClose={() => setIsPresetsModalOpen(false)}
        onSelectPreset={handleSelectPreset}
      />
    </div>
    </div>
  );
}
