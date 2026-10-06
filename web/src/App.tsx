import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { EventsProvider } from './context/EventsContext';
import { UserEventsProvider } from './context/UserEventsContext';
import Layout from './components/Layout';
import { RequireAdmin, RequireAuth, RequireStaff } from './components/RouteGuards';
import Home from './pages/Home';
import ExploreEvents from './pages/ExploreEvents';
import EventDetails from './pages/EventDetails';
import Register from './pages/Register';
import RegistrationSuccess from './pages/RegistrationSuccess';
import MyEvents from './pages/MyEvents';
import CalendarView from './pages/CalendarView';
import StudentProfile from './pages/StudentProfile';
import FeedbackForm from './pages/FeedbackForm';
import SignIn from './pages/SignIn';
import NotFound from './pages/NotFound';
import AdminEvents from './pages/admin/AdminEvents';
import AdminEventForm from './pages/admin/AdminEventForm';
import AdminParticipants from './pages/admin/AdminParticipants';
import AdminCheckIn from './pages/admin/AdminCheckIn';
import AdminAnnouncements from './pages/admin/AdminAnnouncements';
import AdminApprovals from './pages/admin/AdminApprovals';
import AdminOutbox from './pages/admin/AdminOutbox';
import AdminWrapUp from './pages/admin/AdminWrapUp';
import AdminAnalytics from './pages/admin/AdminAnalytics';
import AdminInsights from './pages/admin/AdminInsights';
import AdminOrganizations from './pages/admin/AdminOrganizations';
import AdminOpportunities from './pages/admin/AdminOpportunities';
import AdminPayments from './pages/admin/AdminPayments';
import Clubs from './pages/Clubs';
import ClubPage from './pages/ClubPage';
import { Opportunities, OpportunityDetail } from './pages/Opportunities';
import { MyCertificates, VerifyCertificate } from './pages/Certificates';
import Pay from './pages/Pay';
import Volunteering from './pages/Volunteering';

function App() {
  return (
    <BrowserRouter>
      {/* AuthProvider knows who is signed in; EventsProvider loads published
          events once and shares them; UserEventsProvider holds the student's
          own registrations and saved events from the API. */}
      <AuthProvider>
        <EventsProvider>
          <UserEventsProvider>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="explore" element={<ExploreEvents />} />
                <Route path="event/:id" element={<EventDetails />} />
                <Route path="calendar" element={<CalendarView />} />
                <Route path="sign-in" element={<SignIn />} />
                <Route path="clubs" element={<Clubs />} />
                <Route path="clubs/:slug" element={<ClubPage />} />
                <Route path="opportunities" element={<Opportunities />} />
                <Route path="opportunities/:id" element={<OpportunityDetail />} />
                <Route path="verify/:code" element={<VerifyCertificate />} />

                <Route element={<RequireAuth />}>
                  <Route path="register/:id" element={<Register />} />
                  <Route path="register-success/:id" element={<RegistrationSuccess />} />
                  <Route path="my-events" element={<MyEvents />} />
                  <Route path="profile" element={<StudentProfile />} />
                  <Route path="feedback/:id" element={<FeedbackForm />} />
                  <Route path="certificates" element={<MyCertificates />} />
                  <Route path="pay/:orderId" element={<Pay />} />
                  <Route path="volunteering" element={<Volunteering />} />
                  {/* Door check-in: organizers, admins and the event's volunteers (the server checks). */}
                  <Route path="check-in/:id" element={<AdminCheckIn />} />
                </Route>

                <Route path="admin" element={<RequireStaff />}>
                  <Route index element={<AdminEvents />} />
                  <Route path="events/new" element={<AdminEventForm />} />
                  <Route path="events/:id/edit" element={<AdminEventForm />} />
                  <Route path="events/:id/participants" element={<AdminParticipants />} />
                  <Route path="events/:id/check-in" element={<AdminCheckIn />} />
                  <Route path="events/:id/wrap-up" element={<AdminWrapUp />} />
                  <Route path="events/:id/analytics" element={<AdminAnalytics />} />
                  <Route path="organizations" element={<AdminOrganizations />} />
                  <Route path="opportunities" element={<AdminOpportunities />} />
                  <Route path="events/:id/announcements" element={<AdminAnnouncements />} />
                  <Route element={<RequireAdmin />}>
                    <Route path="approvals" element={<AdminApprovals />} />
                    <Route path="outbox" element={<AdminOutbox />} />
                    <Route path="insights" element={<AdminInsights />} />
                    <Route path="payments" element={<AdminPayments />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </UserEventsProvider>
        </EventsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
