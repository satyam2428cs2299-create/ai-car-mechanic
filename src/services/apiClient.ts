import {
  ApiError,
  ChatMessage,
  ChatSession,
  DiagnosticReport,
  MediaAttachment,
  MechanicBooking,
  VehicleProfile,
} from '../types/mechanic';

const STORAGE_KEY_SESSION = 'ai_mechanic_backend_session_v1';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/$/, '');

export const DEFAULT_VEHICLE: VehicleProfile = {
  year: '2019',
  make: 'Honda',
  model: 'Civic EX',
  mileage: '48,500',
  engine: '2.0L 4-Cylinder i-VTEC',
};

export interface ApiConfig {
  simulatedLatencyMs: number;
  simulatedErrorMode: 'none' | 'network_timeout' | 'server_500';
  apiUrl: string;
}

let apiConfig: ApiConfig = {
  simulatedLatencyMs: 0,
  simulatedErrorMode: 'none',
  apiUrl: API_BASE_URL,
};

export const getApiConfig = (): ApiConfig => ({ ...apiConfig });
export const setApiConfig = (newConfig: Partial<ApiConfig>): void => {
  apiConfig = { ...apiConfig, ...newConfig, apiUrl: API_BASE_URL };
};

interface ChatResponse {
  conversation_id: number;
  user_message: string;
  assistant_response: string;
}

interface DiagnosisResponse {
  problem_summary: string;
  possible_causes: string;
  most_likely_issue: string;
  recommended_service: string;
  urgency: 'low' | 'medium' | 'high';
}

interface BookingResponse {
  id: number;
  conversation: number;
  customer_name: string;
  phone: string;
  vehicle_model: string;
  preferred_date: string;
  preferred_time: string;
  issue_description: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  created_at: string;
}

const formatError = async (response: Response): Promise<ApiError> => {
  let detail = `Request failed with HTTP ${response.status}.`;
  try {
    const body = await response.json();
    const firstError = Object.values(body).flat()[0];
    detail = typeof firstError === 'string' ? firstError : body.detail || detail;
  } catch {
    // Keep the HTTP status message when the response is not JSON.
  }
  return { message: detail, status: response.status, code: 'API_ERROR' };
};

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  if (!response.ok) throw await formatError(response);
  return response.json() as Promise<T>;
};

const backendConversationId = (sessionId: string): number | undefined => {
  const id = Number(sessionId);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

const toLocalMediaType = (type: string): MediaAttachment['type'] => {
  if (type === 'audio' || type === 'video') return type;
  return 'image';
};

const toDiagnosticReport = (data: DiagnosisResponse): DiagnosticReport => {
  const urgency = (data.urgency.charAt(0).toUpperCase() + data.urgency.slice(1)) as DiagnosticReport['urgency'];
  const causes = data.possible_causes
    .split(/,|\.|\n/)
    .map((cause) => cause.trim())
    .filter(Boolean)
    .map((cause, index) => ({
      cause,
      probability: index === 0 ? 'High' : 'Medium' as 'High' | 'Medium',
      percentage: index === 0 ? 65 : 35,
      description: 'Requires inspection to confirm.',
      symptomsMatch: [],
    }));

  return {
    id: `diagnosis-${Date.now()}`,
    problemSummary: data.problem_summary,
    possibleCauses: causes,
    mostLikelyIssue: data.most_likely_issue,
    recommendedRepair: data.recommended_service,
    urgency,
    urgencyReason: 'Based on the backend diagnostic assessment.',
    canDriveSafely: urgency !== 'High',
    drivingAdvice: urgency === 'High'
      ? 'Do not drive the vehicle. Arrange towing or immediate professional inspection.'
      : 'Drive with caution until inspected.',
    estimatedCost: { min: 0, max: 0, currency: 'INR', partsEstimate: 0, laborEstimate: 0 },
    confidenceScore: 0,
    requiresPhysicalInspection: true,
    disclaimer: 'This preliminary assessment requires physical inspection by a qualified technician.',
    createdAt: new Date().toISOString(),
  };
};

const toMechanicBooking = (data: BookingResponse, vehicle: VehicleProfile): MechanicBooking => ({
  id: String(data.id),
  bookingReference: String(data.id),
  customerName: data.customer_name,
  customerPhone: data.phone,
  customerEmail: '',
  serviceType: 'mobile_mechanic',
  preferredDate: data.preferred_date,
  preferredTime: data.preferred_time,
  serviceLocation: '',
  vehicle,
  notes: data.issue_description,
  estimatedCost: { min: 0, max: 0, currency: 'INR' },
  status: data.status,
  createdAt: data.created_at,
});

const createWelcomeSession = (vehicle: VehicleProfile = DEFAULT_VEHICLE, title = 'New Car Diagnostic'): ChatSession => ({
  id: `local-${Date.now()}`,
  title,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  vehicle: { ...vehicle },
  messages: [],
  isDiagnosed: false,
});

class MechanicApiClient {
  private loadSession(): ChatSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      return raw ? JSON.parse(raw) as ChatSession : null;
    } catch {
      return null;
    }
  }

  private saveSession(session: ChatSession): void {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
  }

  public async getSessions(): Promise<ChatSession[]> {
    const session = this.loadSession() || createWelcomeSession();
    this.saveSession(session);
    return [session];
  }

  public async getSession(sessionId: string): Promise<ChatSession | null> {
    const session = this.loadSession();
    return session?.id === sessionId ? session : null;
  }

  public async createSession(vehicle: VehicleProfile = DEFAULT_VEHICLE, title = 'New Car Diagnostic'): Promise<ChatSession> {
    const session = createWelcomeSession(vehicle, title);
    this.saveSession(session);
    return session;
  }

  public async deleteSession(sessionId: string): Promise<void> {
    if (this.loadSession()?.id === sessionId) localStorage.removeItem(STORAGE_KEY_SESSION);
  }

  public async updateVehicle(sessionId: string, vehicle: VehicleProfile): Promise<ChatSession> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const updated = { ...session, vehicle, updatedAt: new Date().toISOString() };
    this.saveSession(updated);
    return updated;
  }

  public async sendMessage(
    sessionId: string,
    content: string,
    attachments: MediaAttachment[] = []
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage; conversationId: number }> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const conversationId = backendConversationId(sessionId);
    const files = attachments.filter((attachment) => attachment.file);
    const body = files.length > 0 ? new FormData() : JSON.stringify({
      ...(conversationId ? { conversation_id: conversationId } : {}),
      message: content || 'Please inspect the attached vehicle media.',
    });
    if (body instanceof FormData) {
      if (conversationId) body.append('conversation_id', String(conversationId));
      body.append('message', content || 'Please inspect the attached vehicle media.');
      files.forEach((attachment) => body.append('files', attachment.file as File));
    }
    const response = await request<ChatResponse>('/api/chat/', { method: 'POST', body });

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content,
      timestamp: new Date().toISOString(),
      attachments: attachments.length ? attachments : undefined,
      status: 'sent',
    };
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      sender: 'assistant',
      content: response.assistant_response,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    const updatedSession: ChatSession = {
      ...session,
      id: String(response.conversation_id),
      title: session.title === 'New Car Diagnostic' && content ? `${content.slice(0, 32)}...` : session.title,
      messages: [...session.messages, userMessage, assistantMessage],
      updatedAt: new Date().toISOString(),
    };
    this.saveSession(updatedSession);

    return { userMessage, assistantMessage, conversationId: response.conversation_id };
  }

  public async uploadMedia(conversationId: number, file: File, messageId?: number): Promise<MediaAttachment> {
    const mediaType = file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'image';
    const formData = new FormData();
    formData.append('conversation_id', String(conversationId));
    formData.append('media_type', mediaType);
    formData.append('file', file);
    if (messageId) formData.append('message_id', String(messageId));

    const response = await request<{
      id: number;
      file_name: string;
      file_size: number;
      media_type: string;
      uploaded_at: string;
    }>('/api/upload/', { method: 'POST', body: formData });

    return {
      id: String(response.id),
      type: toLocalMediaType(response.media_type),
      url: '',
      fileName: response.file_name,
      fileSize: response.file_size,
      mimeType: file.type,
      file,
    };
  }

  public async requestDiagnosis(sessionId: string): Promise<DiagnosticReport> {
    const conversationId = backendConversationId(sessionId);
    if (!conversationId) throw new Error('Send a message before requesting a diagnosis.');
    const diagnosis = toDiagnosticReport(await request<DiagnosisResponse>('/api/diagnosis/', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId }),
    }));
    const session = await this.getSession(sessionId);
    if (session) this.saveSession({ ...session, latestDiagnosis: diagnosis, isDiagnosed: true });
    return diagnosis;
  }

  public async createBooking(
    bookingData: Omit<MechanicBooking, 'id' | 'bookingReference' | 'createdAt' | 'status'>,
    sessionId: string
  ): Promise<MechanicBooking> {
    const conversationId = backendConversationId(sessionId);
    if (!conversationId) throw new Error('Send a message before booking an appointment.');
    const preferredTime = bookingData.preferredTime.match(/(\d{1,2}):(\d{2})/)?.[0] || '09:00';
    const response = await request<{ id: number; booking: BookingResponse }>('/api/booking/', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        customer_name: bookingData.customerName,
        phone: bookingData.customerPhone,
        vehicle_model: `${bookingData.vehicle.year} ${bookingData.vehicle.make} ${bookingData.vehicle.model}`,
        preferred_date: bookingData.preferredDate,
        preferred_time: `${preferredTime}:00`,
        issue_description: [
          bookingData.attachedDiagnosis?.mostLikelyIssue || 'Vehicle inspection requested.',
          bookingData.notes,
          `Requested service: ${bookingData.serviceType.replace(/_/g, ' ')}.`,
          bookingData.serviceLocation ? `Location: ${bookingData.serviceLocation}.` : '',
          bookingData.customerEmail ? `Contact email: ${bookingData.customerEmail}.` : '',
        ].filter(Boolean).join(' '),
      }),
    });
    const savedBooking = await this.getBooking(String(response.id), bookingData.vehicle);
    const session = await this.getSession(sessionId);
    if (session) this.saveSession({ ...session, booking: savedBooking });
    return savedBooking;
  }

  public async getBooking(bookingId: string, vehicle: VehicleProfile = DEFAULT_VEHICLE): Promise<MechanicBooking> {
    const response = await request<BookingResponse>(`/api/booking/${bookingId}/`);
    return toMechanicBooking(response, vehicle);
  }
}

export const apiClient = new MechanicApiClient();
