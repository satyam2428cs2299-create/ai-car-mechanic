import React, { useState } from 'react';
import {
  X,
  Calendar,
  Clock,
  Car,
  CheckCircle2,
  MapPin,
  User,
  Phone,
  Mail,
  FileText,
  Info,
  ShieldCheck,
  Star,
  Printer,
  CalendarPlus,
  Loader2,
} from 'lucide-react';
import {
  DiagnosticReport,
  MechanicBooking,
  VehicleProfile,
} from '../types/mechanic';
import { apiClient } from '../services/apiClient';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagnosis: DiagnosticReport;
  vehicle: VehicleProfile;
  conversationId?: string;
  onBookingSuccess: (booking: MechanicBooking) => void;
  existingBooking?: MechanicBooking;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  diagnosis,
  vehicle,
  conversationId,
  onBookingSuccess,
  existingBooking,
}) => {
  const formatIndianDate = (value: string) => {
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  };

  // If an existing booking is already present, show confirmation screen immediately
  const [confirmedBooking, setConfirmedBooking] = useState<MechanicBooking | null>(
    existingBooking || null
  );

  const [serviceType, setServiceType] = useState<
    'mobile_mechanic' | 'service_center' | 'towing_and_repair'
  >(diagnosis.canDriveSafely ? 'mobile_mechanic' : 'towing_and_repair');

  // Form states
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('+91 ');
  const [customerEmail, setCustomerEmail] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [preferredDate, setPreferredDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [preferredTime, setPreferredTime] = useState('Morning (8:00 AM - 11:00 AM)');
  const [notes, setNotes] = useState(
    ''
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!conversationId) throw new Error('Send a chat message before booking an appointment.');
      const newBooking = await apiClient.createBooking({
        customerName,
        customerPhone,
        customerEmail,
        serviceType,
        serviceLocation:
          serviceAddress,
        preferredDate,
        preferredTime,
        vehicle,
        attachedDiagnosis: diagnosis,
        notes,
        estimatedCost: {
          min: diagnosis.estimatedCost.min,
          max: diagnosis.estimatedCost.max,
          currency: 'INR',
        },
      }, conversationId);

      setConfirmedBooking(newBooking);
      onBookingSuccess(newBooking);
    } catch (err: any) {
      console.error('Booking failed', err);
      setSubmitError(err.message || 'Failed to submit service booking. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadCalendar = () => {
    if (!confirmedBooking) return;
    const icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//AI Car Mechanic//Service Appointment//EN
BEGIN:VEVENT
SUMMARY:Mechanic Service: ${confirmedBooking.vehicle.year} ${confirmedBooking.vehicle.make} ${confirmedBooking.vehicle.model}
DESCRIPTION:Issue: ${diagnosis.mostLikelyIssue}. Booking Ref: ${confirmedBooking.bookingReference}
LOCATION:${confirmedBooking.serviceLocation}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `mechanic_appointment_${confirmedBooking.bookingReference}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[92vh]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">
                {confirmedBooking ? 'Service Work Order Confirmed' : 'Schedule Certified Mechanic'}
              </h3>
              <p className="text-xs text-slate-400">
                {confirmedBooking
                  ? `Booking ID #${confirmedBooking.id}`
                  : 'Delhi NCR car inspection request'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* CONFIRMATION SCREEN */}
          {confirmedBooking ? (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-3 ring-8 ring-emerald-500/10">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <h4 className="text-xl font-bold text-white">Your mechanic booking has been created successfully.</h4>
                <p className="text-xs text-slate-400 max-w-md mt-1">
                  Your request has been sent to the Django booking service. Review the submitted details below.
                </p>
                <div className="mt-3 inline-flex items-center gap-2 bg-slate-950 px-4 py-1.5 rounded-full border border-slate-800 text-amber-400 font-mono text-sm font-bold">
                  Booking ID: {confirmedBooking.id}
                </div>
              </div>

              {/* Technician Info Card */}
              {confirmedBooking.assignedTechnician && (
                <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-left flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg shrink-0">
                    DK
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h5 className="text-sm font-bold text-white">
                        {confirmedBooking.assignedTechnician.name}
                      </h5>
                      <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md font-bold">
                        <Star className="w-3.5 h-3.5 fill-current" /> {confirmedBooking.assignedTechnician.rating}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {confirmedBooking.assignedTechnician.experienceYears} Years Automotive Experience
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {confirmedBooking.assignedTechnician.certifications.map((cert, cIdx) => (
                        <span
                          key={cIdx}
                          className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-sm border border-slate-700"
                        >
                          ✓ {cert}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Appointment Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                    Appointment Details
                  </span>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 mb-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" /> {formatIndianDate(confirmedBooking.preferredDate)}
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-400" /> {confirmedBooking.preferredTime}
                  </div>
                </div>

                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">
                    Vehicle On File
                  </span>
                  <div className="text-xs font-semibold text-slate-200">
                    {confirmedBooking.vehicle.year} {confirmedBooking.vehicle.make} {confirmedBooking.vehicle.model}
                  </div>
                  <div className="text-xs text-slate-400">
                    Odometer: {confirmedBooking.vehicle.mileage} km
                  </div>
                </div>

                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">Issue</span>
                  <div className="text-xs font-semibold text-amber-400">{confirmedBooking.notes || diagnosis.mostLikelyIssue}</div>
                  <div className="text-xs text-slate-400 mt-1">Status: {confirmedBooking.status}</div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={handleDownloadCalendar}
                  className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center justify-center gap-2"
                >
                  <CalendarPlus className="w-4 h-4 text-amber-400" /> Add to Calendar (.ics)
                </button>
                <button
                  onClick={() => window.print()}
                  className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" /> Print Work Order
                </button>
                <button
                  onClick={onClose}
                  className="py-3 px-6 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-lg transition"
                >
                  Return to Chat
                </button>
              </div>
            </div>
          ) : (
            /* BOOKING FORM SCREEN */
            <form onSubmit={handleSubmitBooking} className="space-y-5">
              {submitError && (
                <div className="p-3 bg-red-950/80 border border-red-500/50 rounded-xl text-xs text-red-300">
                  {submitError}
                </div>
              )}

              {/* Pre-filled Diagnosis Info Pill */}
              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">
                    Diagnostic Summary Attached to Work Order
                  </span>
                  <p className="text-xs sm:text-sm font-semibold text-slate-200">
                    {diagnosis.mostLikelyIssue}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Car className="w-3.5 h-3.5 text-blue-400" />
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </span>
                    <span className="flex items-center gap-1">
                      <Info className="w-3.5 h-3.5 text-emerald-400" />
                      Pricing will be confirmed after inspection.
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold ${
                      diagnosis.urgency === 'Critical'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {diagnosis.urgency} Urgency
                  </span>
                </div>
              </div>

              {/* Service Method Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Choose Service Delivery Method
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setServiceType('mobile_mechanic')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                      serviceType === 'mobile_mechanic'
                        ? 'bg-amber-500/10 border-amber-500 text-white'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">Mobile Mechanic</span>
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Tech arrives at your home or work driveway with fully equipped mobile van.
                      </p>
                    </div>
                    <span className="text-[10px] text-emerald-400 font-semibold mt-2">
                      Most Convenient
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setServiceType('service_center')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                      serviceType === 'service_center'
                        ? 'bg-amber-500/10 border-amber-500 text-white'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">Service Center Bay</span>
                        <Car className="w-3.5 h-3.5 text-blue-400" />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Drive in for heavy hydraulic lift repairs and wheel alignment equipment.
                      </p>
                    </div>
                    <span className="text-[10px] text-blue-400 font-semibold mt-2">
                      Full Shop Tools
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setServiceType('towing_and_repair')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                      serviceType === 'towing_and_repair'
                        ? 'bg-red-500/10 border-red-500 text-white'
                        : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">Flatbed Tow + Repair</span>
                        <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Recommended for critical overheating or active engine misfires.
                      </p>
                    </div>
                    <span className="text-[10px] text-red-400 font-semibold mt-2">
                      Safe Transport
                    </span>
                  </button>
                </div>
              </div>

              {/* Date & Time Preferences */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" /> Preferred Date
                  </label>
                      <input
                    type="date"
                    required
                    value={preferredDate}
                    onChange={(e) => setPreferredDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-hidden focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" /> Time Window
                  </label>
                  <select
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="Morning (8:00 AM - 11:00 AM)">Morning (8:00 AM - 11:00 AM)</option>
                    <option value="Midday (11:00 AM - 2:00 PM)">Midday (11:00 AM - 2:00 PM)</option>
                    <option value="Afternoon (2:00 PM - 5:00 PM)">Afternoon (2:00 PM - 5:00 PM)</option>
                    <option value="Evening Emergency Slot (5:00 PM - 8:00 PM)">Evening Emergency Slot (5:00 PM - 8:00 PM)</option>
                  </select>
                </div>
              </div>

              {/* Customer Contact Details */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-400" /> Your Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" /> Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+91 98XXXXXXXX"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                      <Mail className="w-3 h-3 text-slate-400" /> Email Address
                    </label>
                      <input
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="name@example.com (optional)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500"
                    />
                  </div>
                </div>

                {serviceType !== 'service_center' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" /> Service Location Address
                    </label>
                    <input
                      type="text"
                      required
                      value={serviceAddress}
                      onChange={(e) => setServiceAddress(e.target.value)}
                      placeholder="Street address, city, state, zip"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-slate-400" /> Instructions for Technician (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="E.g., Park in visitor spot #12, key is under the front mat..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-hidden focus:border-amber-500 resize-none"
                  />
                </div>
              </div>

              {/* Warranty & Guarantee Callout */}
              <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      Service details are reviewed by the mechanic before inspection.
                </span>
                <span className="text-slate-500 hidden sm:inline">No charge until diagnosis verified</span>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Confirming Work Order...
                    </>
                  ) : (
                    'Confirm Appointment Request'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
