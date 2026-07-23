--
-- PostgreSQL database dump
--

\restrict YXVuFOM82RP4T2zrcfEpymCBlrTVRznjYf0BcmfijpnJ8EVmap2tOfshdEdGmIp

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg13+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: leads; Type: SCHEMA; Schema: -; Owner: mcp_engineer
--

CREATE SCHEMA leads;


ALTER SCHEMA leads OWNER TO mcp_engineer;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_suggestions; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.ai_suggestions (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    suggestion_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT ai_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'used'::text, 'dismissed'::text]))),
    CONSTRAINT ai_suggestions_suggestion_type_check CHECK ((suggestion_type = ANY (ARRAY['reply_suggestion'::text, 'proposal_draft'::text, 'call_summary'::text, 'meeting_summary'::text, 'sales_coaching'::text, 'risk_detection'::text])))
);


ALTER TABLE leads.ai_suggestions OWNER TO ivan;

--
-- Name: ai_suggestions_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.ai_suggestions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.ai_suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidates; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.candidates (
    id bigint NOT NULL,
    source_id smallint NOT NULL,
    segment_id smallint,
    external_ref text NOT NULL,
    business_name text NOT NULL,
    address text,
    suburb text,
    state text DEFAULT 'SA'::text,
    postcode text,
    phone text,
    website text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    discovery_run_id bigint,
    stage text DEFAULT 'discovered'::text NOT NULL,
    stage_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    enrichment jsonb DEFAULT '{}'::jsonb NOT NULL,
    enriched_at timestamp with time zone,
    linkedin_url text,
    qualification_score integer,
    qualification jsonb DEFAULT '{}'::jsonb NOT NULL,
    qualified_at timestamp with time zone,
    shortlist_rank integer,
    duplicate_of bigint,
    do_not_contact boolean DEFAULT false NOT NULL,
    excluded_from_outreach boolean DEFAULT false NOT NULL,
    CONSTRAINT candidates_stage_check CHECK ((stage = ANY (ARRAY['discovered'::text, 'enriched'::text, 'qualified'::text, 'disqualified'::text, 'proposal_ready'::text, 'outreach_active'::text, 'appointment'::text, 'lost'::text, 'won'::text])))
);


ALTER TABLE leads.candidates OWNER TO mcp_engineer;

--
-- Name: candidates_id_seq; Type: SEQUENCE; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE leads.candidates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_records; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.crm_records (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    stage text DEFAULT 'new'::text NOT NULL,
    owner text,
    last_contact_at timestamp with time zone,
    next_action text,
    next_action_due date,
    notes text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    added_by text,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes_updated_at timestamp with time zone,
    pipeline_stage text DEFAULT 'New'::text NOT NULL,
    conversion_score smallint,
    conversion_factors jsonb DEFAULT '{}'::jsonb NOT NULL,
    conversion_score_updated_at timestamp with time zone,
    next_best_action text,
    next_best_action_reason text,
    next_best_action_updated_at timestamp with time zone,
    opportunity_health text,
    estimated_value numeric(10,2),
    is_customer boolean DEFAULT false NOT NULL,
    pipeline_stage_updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT crm_records_next_best_action_check CHECK (((next_best_action IS NULL) OR (next_best_action = ANY (ARRAY['Send first email'::text, 'Call today'::text, 'Wait'::text, 'Send proposal'::text, 'Schedule site inspection'::text, 'Follow up'::text, 'Mark lost'::text, 'Convert to customer'::text, 'Respond to reply'::text, 'Follow up on proposal'::text])))),
    CONSTRAINT crm_records_opportunity_health_check CHECK (((opportunity_health IS NULL) OR (opportunity_health = ANY (ARRAY['Healthy'::text, 'At Risk'::text, 'Stalled'::text])))),
    CONSTRAINT crm_records_pipeline_stage_check CHECK ((pipeline_stage = ANY (ARRAY['New'::text, 'Qualified'::text, 'Contacted'::text, 'Interested'::text, 'Needs Follow-up'::text, 'Proposal Requested'::text, 'Proposal Sent'::text, 'Negotiating'::text, 'Site Visit Scheduled'::text, 'Awaiting Decision'::text, 'Won'::text, 'Lost'::text, 'Repeat Customer'::text]))),
    CONSTRAINT crm_records_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'sent'::text]))),
    CONSTRAINT crm_records_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'contacted'::text, 'replied'::text, 'meeting'::text, 'quote_sent'::text, 'negotiation'::text, 'won'::text, 'lost'::text]))),
    CONSTRAINT crm_records_status_check CHECK ((status = ANY (ARRAY['active'::text, 'won'::text, 'lost'::text, 'archived'::text])))
);


ALTER TABLE leads.crm_records OWNER TO ivan;

--
-- Name: crm_records_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

CREATE SEQUENCE leads.crm_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE leads.crm_records_id_seq OWNER TO ivan;

--
-- Name: crm_records_id_seq; Type: SEQUENCE OWNED BY; Schema: leads; Owner: ivan
--

ALTER SEQUENCE leads.crm_records_id_seq OWNED BY leads.crm_records.id;


--
-- Name: crm_stage_history; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.crm_stage_history (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    stage text NOT NULL,
    changed_by text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE leads.crm_stage_history OWNER TO ivan;

--
-- Name: crm_stage_history_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

CREATE SEQUENCE leads.crm_stage_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE leads.crm_stage_history_id_seq OWNER TO ivan;

--
-- Name: crm_stage_history_id_seq; Type: SEQUENCE OWNED BY; Schema: leads; Owner: ivan
--

ALTER SEQUENCE leads.crm_stage_history_id_seq OWNED BY leads.crm_stage_history.id;


--
-- Name: customer_service_history; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.customer_service_history (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    service_type text NOT NULL,
    scheduled_at timestamp with time zone,
    completed_at timestamp with time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_service_history_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text])))
);


ALTER TABLE leads.customer_service_history OWNER TO ivan;

--
-- Name: customer_service_history_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.customer_service_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.customer_service_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: customers; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.customers (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    crm_record_id bigint,
    company_name text NOT NULL,
    address text,
    contacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    services jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    converted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


ALTER TABLE leads.customers OWNER TO ivan;

--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.customers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: dashboard_sessions; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.dashboard_sessions (
    token text NOT NULL,
    user_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE leads.dashboard_sessions OWNER TO mcp_engineer;

--
-- Name: dashboard_users; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.dashboard_users (
    name text NOT NULL,
    salt text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE leads.dashboard_users OWNER TO mcp_engineer;

--
-- Name: discovery_runs; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.discovery_runs (
    id bigint NOT NULL,
    source_id smallint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    candidates_found integer DEFAULT 0 NOT NULL,
    candidates_new integer DEFAULT 0 NOT NULL,
    error text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT discovery_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'partial'::text])))
);


ALTER TABLE leads.discovery_runs OWNER TO mcp_engineer;

--
-- Name: discovery_runs_id_seq; Type: SEQUENCE; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE leads.discovery_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.discovery_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inbound_replies; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.inbound_replies (
    id bigint NOT NULL,
    candidate_id bigint,
    message_id text NOT NULL,
    in_reply_to text,
    "references" text[],
    subject text,
    sender text,
    body_text text,
    received_at timestamp with time zone NOT NULL,
    matched_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbound_replies_matched_by_check CHECK ((matched_by = ANY (ARRAY['message_id'::text, 'references'::text, 'email_fallback'::text, 'subject'::text, 'unmatched'::text])))
);


ALTER TABLE leads.inbound_replies OWNER TO ivan;

--
-- Name: inbound_replies_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

CREATE SEQUENCE leads.inbound_replies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE leads.inbound_replies_id_seq OWNER TO ivan;

--
-- Name: inbound_replies_id_seq; Type: SEQUENCE OWNED BY; Schema: leads; Owner: ivan
--

ALTER SEQUENCE leads.inbound_replies_id_seq OWNED BY leads.inbound_replies.id;


--
-- Name: notifications; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.notifications (
    id bigint NOT NULL,
    type text NOT NULL,
    candidate_id bigint,
    title text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    severity text DEFAULT 'info'::text NOT NULL,
    CONSTRAINT notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text])))
);


ALTER TABLE leads.notifications OWNER TO ivan;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

CREATE SEQUENCE leads.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE leads.notifications_id_seq OWNER TO ivan;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: leads; Owner: ivan
--

ALTER SEQUENCE leads.notifications_id_seq OWNED BY leads.notifications.id;


--
-- Name: opportunity_scores; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.opportunity_scores (
    candidate_id bigint NOT NULL,
    conversion_score smallint NOT NULL,
    conversion_factors jsonb DEFAULT '{}'::jsonb NOT NULL,
    opportunity_health text,
    next_best_action text,
    next_best_action_reason text,
    proposal_readiness text DEFAULT 'Not Ready'::text NOT NULL,
    customer_readiness text DEFAULT 'Not Ready'::text NOT NULL,
    conversion_probability numeric(5,2) DEFAULT 0 NOT NULL,
    estimated_value numeric(10,2),
    has_crm_record boolean DEFAULT false NOT NULL,
    is_customer boolean DEFAULT false NOT NULL,
    candidate_updated_at timestamp with time zone NOT NULL,
    scored_at timestamp with time zone DEFAULT now() NOT NULL,
    scoring_version text DEFAULT 'conv_v1'::text NOT NULL,
    CONSTRAINT opportunity_scores_conversion_probability_check CHECK (((conversion_probability >= (0)::numeric) AND (conversion_probability <= (1)::numeric))),
    CONSTRAINT opportunity_scores_customer_readiness_check CHECK ((customer_readiness = ANY (ARRAY['Ready'::text, 'Not Ready'::text]))),
    CONSTRAINT opportunity_scores_opportunity_health_check CHECK (((opportunity_health IS NULL) OR (opportunity_health = ANY (ARRAY['Healthy'::text, 'At Risk'::text, 'Stalled'::text])))),
    CONSTRAINT opportunity_scores_proposal_readiness_check CHECK ((proposal_readiness = ANY (ARRAY['Ready'::text, 'Not Ready'::text])))
);


ALTER TABLE leads.opportunity_scores OWNER TO ivan;

--
-- Name: outreach_drafts; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.outreach_drafts (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    method text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    sent_to text,
    approved_by text,
    sent_by text,
    followup_count integer DEFAULT 0 NOT NULL,
    last_followup_at timestamp with time zone,
    message_id text,
    CONSTRAINT outreach_drafts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'rejected'::text, 'sent'::text])))
);


ALTER TABLE leads.outreach_drafts OWNER TO mcp_engineer;

--
-- Name: outreach_drafts_id_seq; Type: SEQUENCE; Schema: leads; Owner: mcp_engineer
--

CREATE SEQUENCE leads.outreach_drafts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE leads.outreach_drafts_id_seq OWNER TO mcp_engineer;

--
-- Name: outreach_drafts_id_seq; Type: SEQUENCE OWNED BY; Schema: leads; Owner: mcp_engineer
--

ALTER SEQUENCE leads.outreach_drafts_id_seq OWNED BY leads.outreach_drafts.id;


--
-- Name: outreach_followups; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.outreach_followups (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    followup_no smallint NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    sent_to text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    message_id text
);


ALTER TABLE leads.outreach_followups OWNER TO ivan;

--
-- Name: outreach_followups_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

CREATE SEQUENCE leads.outreach_followups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE leads.outreach_followups_id_seq OWNER TO ivan;

--
-- Name: outreach_followups_id_seq; Type: SEQUENCE OWNED BY; Schema: leads; Owner: ivan
--

ALTER SEQUENCE leads.outreach_followups_id_seq OWNED BY leads.outreach_followups.id;


--
-- Name: outreach_queue; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.outreach_queue (
    id bigint NOT NULL,
    run_date date NOT NULL,
    candidate_id bigint NOT NULL,
    business_name text,
    qualification_score integer,
    status text NOT NULL,
    reason text,
    validation jsonb DEFAULT '{}'::jsonb NOT NULL,
    email_generated boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone,
    message_id text,
    crm_updated boolean DEFAULT false NOT NULL,
    notification_created boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_queue_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'validated'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


ALTER TABLE leads.outreach_queue OWNER TO ivan;

--
-- Name: outreach_queue_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.outreach_queue ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.outreach_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: outreach_runs; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.outreach_runs (
    run_date date NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    abort_reason text,
    sent_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    threshold_used integer,
    cap_used integer,
    CONSTRAINT outreach_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'aborted'::text])))
);


ALTER TABLE leads.outreach_runs OWNER TO ivan;

--
-- Name: proposals; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.proposals (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    crm_record_id bigint,
    status text DEFAULT 'draft'::text NOT NULL,
    title text,
    amount numeric(10,2),
    valid_until date,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    decided_at timestamp with time zone,
    CONSTRAINT proposals_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))
);


ALTER TABLE leads.proposals OWNER TO ivan;

--
-- Name: proposals_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.proposals ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.proposals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sales_timeline; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.sales_timeline (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    event_type text NOT NULL,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    summary text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_timeline_event_type_check CHECK ((event_type = ANY (ARRAY['call'::text, 'email'::text, 'reply'::text, 'meeting'::text, 'site_visit'::text, 'proposal_event'::text, 'stage_change'::text, 'note'::text])))
);


ALTER TABLE leads.sales_timeline OWNER TO ivan;

--
-- Name: sales_timeline_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.sales_timeline ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.sales_timeline_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.schema_migrations (
    version integer NOT NULL,
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE leads.schema_migrations OWNER TO mcp_engineer;

--
-- Name: segments; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.segments (
    id smallint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    search_terms jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    priority_weight smallint DEFAULT 5 NOT NULL
);


ALTER TABLE leads.segments OWNER TO mcp_engineer;

--
-- Name: segments_id_seq; Type: SEQUENCE; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE leads.segments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.segments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sources; Type: TABLE; Schema: leads; Owner: mcp_engineer
--

CREATE TABLE leads.sources (
    id smallint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE leads.sources OWNER TO mcp_engineer;

--
-- Name: sources_id_seq; Type: SEQUENCE; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE leads.sources ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.sources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: system_settings; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.system_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text
);


ALTER TABLE leads.system_settings OWNER TO ivan;

--
-- Name: v_sales_timeline; Type: VIEW; Schema: leads; Owner: ivan
--

CREATE VIEW leads.v_sales_timeline AS
 SELECT sales_timeline.candidate_id,
    sales_timeline.event_type,
    sales_timeline.event_at,
    sales_timeline.summary,
    sales_timeline.detail,
    sales_timeline.created_by
   FROM leads.sales_timeline
UNION ALL
 SELECT crm_stage_history.candidate_id,
    'stage_change'::text AS event_type,
    crm_stage_history.changed_at AS event_at,
    ('CRM stage changed to '::text || crm_stage_history.stage) AS summary,
    jsonb_build_object('stage', crm_stage_history.stage) AS detail,
    crm_stage_history.changed_by AS created_by
   FROM leads.crm_stage_history
UNION ALL
 SELECT outreach_drafts.candidate_id,
    'email'::text AS event_type,
    outreach_drafts.sent_at AS event_at,
    'Outreach email sent'::text AS summary,
    jsonb_build_object('subject', outreach_drafts.subject, 'method', outreach_drafts.method) AS detail,
    COALESCE(outreach_drafts.sent_by, outreach_drafts.approved_by) AS created_by
   FROM leads.outreach_drafts
  WHERE (outreach_drafts.sent_at IS NOT NULL)
UNION ALL
 SELECT outreach_followups.candidate_id,
    'email'::text AS event_type,
    outreach_followups.sent_at AS event_at,
    (('Follow-up #'::text || outreach_followups.followup_no) || ' sent'::text) AS summary,
    jsonb_build_object('subject', outreach_followups.subject) AS detail,
    NULL::text AS created_by
   FROM leads.outreach_followups
UNION ALL
 SELECT inbound_replies.candidate_id,
    'reply'::text AS event_type,
    inbound_replies.received_at AS event_at,
    ('Reply received: '::text || COALESCE(inbound_replies.subject, '(no subject)'::text)) AS summary,
    jsonb_build_object('sender', inbound_replies.sender, 'matched_by', inbound_replies.matched_by) AS detail,
    NULL::text AS created_by
   FROM leads.inbound_replies
  WHERE (inbound_replies.candidate_id IS NOT NULL);


ALTER VIEW leads.v_sales_timeline OWNER TO ivan;

--
-- Name: website_quotes; Type: TABLE; Schema: leads; Owner: ivan
--

CREATE TABLE leads.website_quotes (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending_review'::text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    company text,
    property_type text,
    bedrooms smallint,
    bathrooms smallint,
    property_size numeric(8,1),
    service_type text NOT NULL,
    extras jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_date date,
    message text,
    estimated_quote numeric(10,2),
    source text DEFAULT 'website'::text NOT NULL,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    ip_hash text,
    user_agent text,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT website_quotes_contact_check CHECK (((email IS NOT NULL) OR (phone IS NOT NULL))),
    CONSTRAINT website_quotes_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'reviewed'::text, 'contacted'::text, 'converted'::text, 'rejected'::text, 'spam'::text])))
);


ALTER TABLE leads.website_quotes OWNER TO ivan;

--
-- Name: website_quotes_id_seq; Type: SEQUENCE; Schema: leads; Owner: ivan
--

ALTER TABLE leads.website_quotes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME leads.website_quotes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_records id; Type: DEFAULT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_records ALTER COLUMN id SET DEFAULT nextval('leads.crm_records_id_seq'::regclass);


--
-- Name: crm_stage_history id; Type: DEFAULT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_stage_history ALTER COLUMN id SET DEFAULT nextval('leads.crm_stage_history_id_seq'::regclass);


--
-- Name: inbound_replies id; Type: DEFAULT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.inbound_replies ALTER COLUMN id SET DEFAULT nextval('leads.inbound_replies_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.notifications ALTER COLUMN id SET DEFAULT nextval('leads.notifications_id_seq'::regclass);


--
-- Name: outreach_drafts id; Type: DEFAULT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.outreach_drafts ALTER COLUMN id SET DEFAULT nextval('leads.outreach_drafts_id_seq'::regclass);


--
-- Name: outreach_followups id; Type: DEFAULT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_followups ALTER COLUMN id SET DEFAULT nextval('leads.outreach_followups_id_seq'::regclass);


--
-- Name: ai_suggestions ai_suggestions_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.ai_suggestions
    ADD CONSTRAINT ai_suggestions_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_source_id_external_ref_key; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.candidates
    ADD CONSTRAINT candidates_source_id_external_ref_key UNIQUE (source_id, external_ref);


--
-- Name: crm_records crm_records_candidate_id_key; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_records
    ADD CONSTRAINT crm_records_candidate_id_key UNIQUE (candidate_id);


--
-- Name: crm_records crm_records_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_records
    ADD CONSTRAINT crm_records_pkey PRIMARY KEY (id);


--
-- Name: crm_stage_history crm_stage_history_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_stage_history
    ADD CONSTRAINT crm_stage_history_pkey PRIMARY KEY (id);


--
-- Name: customer_service_history customer_service_history_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.customer_service_history
    ADD CONSTRAINT customer_service_history_pkey PRIMARY KEY (id);


--
-- Name: customers customers_candidate_id_key; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.customers
    ADD CONSTRAINT customers_candidate_id_key UNIQUE (candidate_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: dashboard_sessions dashboard_sessions_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.dashboard_sessions
    ADD CONSTRAINT dashboard_sessions_pkey PRIMARY KEY (token);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (name);


--
-- Name: discovery_runs discovery_runs_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.discovery_runs
    ADD CONSTRAINT discovery_runs_pkey PRIMARY KEY (id);


--
-- Name: inbound_replies inbound_replies_message_id_key; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.inbound_replies
    ADD CONSTRAINT inbound_replies_message_id_key UNIQUE (message_id);


--
-- Name: inbound_replies inbound_replies_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.inbound_replies
    ADD CONSTRAINT inbound_replies_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: opportunity_scores opportunity_scores_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.opportunity_scores
    ADD CONSTRAINT opportunity_scores_pkey PRIMARY KEY (candidate_id);


--
-- Name: outreach_drafts outreach_drafts_candidate_id_key; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.outreach_drafts
    ADD CONSTRAINT outreach_drafts_candidate_id_key UNIQUE (candidate_id);


--
-- Name: outreach_drafts outreach_drafts_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.outreach_drafts
    ADD CONSTRAINT outreach_drafts_pkey PRIMARY KEY (id);


--
-- Name: outreach_followups outreach_followups_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_followups
    ADD CONSTRAINT outreach_followups_pkey PRIMARY KEY (id);


--
-- Name: outreach_queue outreach_queue_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_queue
    ADD CONSTRAINT outreach_queue_pkey PRIMARY KEY (id);


--
-- Name: outreach_queue outreach_queue_run_date_candidate_id_key; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_queue
    ADD CONSTRAINT outreach_queue_run_date_candidate_id_key UNIQUE (run_date, candidate_id);


--
-- Name: outreach_runs outreach_runs_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_runs
    ADD CONSTRAINT outreach_runs_pkey PRIMARY KEY (run_date);


--
-- Name: proposals proposals_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);


--
-- Name: sales_timeline sales_timeline_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.sales_timeline
    ADD CONSTRAINT sales_timeline_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: segments segments_code_key; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.segments
    ADD CONSTRAINT segments_code_key UNIQUE (code);


--
-- Name: segments segments_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.segments
    ADD CONSTRAINT segments_pkey PRIMARY KEY (id);


--
-- Name: sources sources_code_key; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.sources
    ADD CONSTRAINT sources_code_key UNIQUE (code);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: outreach_followups ux_outreach_followups_candidate_followup; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_followups
    ADD CONSTRAINT ux_outreach_followups_candidate_followup UNIQUE (candidate_id, followup_no);


--
-- Name: website_quotes website_quotes_pkey; Type: CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.website_quotes
    ADD CONSTRAINT website_quotes_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_suggestions_candidate; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_ai_suggestions_candidate ON leads.ai_suggestions USING btree (candidate_id);


--
-- Name: idx_ai_suggestions_status; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_ai_suggestions_status ON leads.ai_suggestions USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_candidates_discovered_at; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_candidates_discovered_at ON leads.candidates USING btree (discovered_at);


--
-- Name: idx_candidates_duplicate; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_candidates_duplicate ON leads.candidates USING btree (duplicate_of) WHERE (duplicate_of IS NOT NULL);


--
-- Name: idx_candidates_email; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_candidates_email ON leads.candidates USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_candidates_segment; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_candidates_segment ON leads.candidates USING btree (segment_id);


--
-- Name: idx_candidates_shortlist; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_candidates_shortlist ON leads.candidates USING btree (shortlist_rank) WHERE (shortlist_rank IS NOT NULL);


--
-- Name: idx_candidates_stage; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_candidates_stage ON leads.candidates USING btree (stage);


--
-- Name: idx_crm_records_conversion_score; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_crm_records_conversion_score ON leads.crm_records USING btree (conversion_score DESC NULLS LAST);


--
-- Name: idx_crm_records_pipeline_stage; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_crm_records_pipeline_stage ON leads.crm_records USING btree (pipeline_stage);


--
-- Name: idx_crm_records_stage; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_crm_records_stage ON leads.crm_records USING btree (stage);


--
-- Name: idx_crm_records_updated; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_crm_records_updated ON leads.crm_records USING btree (updated_at DESC);


--
-- Name: idx_customer_service_history_customer; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_customer_service_history_customer ON leads.customer_service_history USING btree (customer_id);


--
-- Name: idx_customers_status; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_customers_status ON leads.customers USING btree (status);


--
-- Name: idx_dashboard_sessions_expiry; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_dashboard_sessions_expiry ON leads.dashboard_sessions USING btree (expires_at);


--
-- Name: idx_followups_candidate; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_followups_candidate ON leads.outreach_followups USING btree (candidate_id);


--
-- Name: idx_opportunity_scores_score; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_opportunity_scores_score ON leads.opportunity_scores USING btree (conversion_score DESC);


--
-- Name: idx_opportunity_scores_scored_at; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_opportunity_scores_scored_at ON leads.opportunity_scores USING btree (scored_at);


--
-- Name: idx_outreach_drafts_status; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE INDEX idx_outreach_drafts_status ON leads.outreach_drafts USING btree (status);


--
-- Name: idx_outreach_queue_run_date; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_outreach_queue_run_date ON leads.outreach_queue USING btree (run_date);


--
-- Name: idx_proposals_candidate; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_proposals_candidate ON leads.proposals USING btree (candidate_id);


--
-- Name: idx_proposals_status; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_proposals_status ON leads.proposals USING btree (status);


--
-- Name: idx_sales_timeline_candidate; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_sales_timeline_candidate ON leads.sales_timeline USING btree (candidate_id, event_at DESC);


--
-- Name: idx_website_quotes_created_at; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_website_quotes_created_at ON leads.website_quotes USING btree (created_at DESC);


--
-- Name: idx_website_quotes_status; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX idx_website_quotes_status ON leads.website_quotes USING btree (status);


--
-- Name: ix_crm_stage_history_candidate; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX ix_crm_stage_history_candidate ON leads.crm_stage_history USING btree (candidate_id);


--
-- Name: ix_inbound_replies_candidate; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX ix_inbound_replies_candidate ON leads.inbound_replies USING btree (candidate_id);


--
-- Name: ix_inbound_replies_received; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX ix_inbound_replies_received ON leads.inbound_replies USING btree (received_at DESC);


--
-- Name: ix_notifications_created; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX ix_notifications_created ON leads.notifications USING btree (created_at DESC);


--
-- Name: ix_notifications_read; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX ix_notifications_read ON leads.notifications USING btree (read_at) WHERE (read_at IS NULL);


--
-- Name: ix_outreach_followups_message_id; Type: INDEX; Schema: leads; Owner: ivan
--

CREATE INDEX ix_outreach_followups_message_id ON leads.outreach_followups USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: ux_outreach_drafts_message_id; Type: INDEX; Schema: leads; Owner: mcp_engineer
--

CREATE UNIQUE INDEX ux_outreach_drafts_message_id ON leads.outreach_drafts USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: ai_suggestions ai_suggestions_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.ai_suggestions
    ADD CONSTRAINT ai_suggestions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: candidates candidates_discovery_run_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.candidates
    ADD CONSTRAINT candidates_discovery_run_id_fkey FOREIGN KEY (discovery_run_id) REFERENCES leads.discovery_runs(id);


--
-- Name: candidates candidates_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.candidates
    ADD CONSTRAINT candidates_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES leads.candidates(id);


--
-- Name: candidates candidates_segment_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.candidates
    ADD CONSTRAINT candidates_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES leads.segments(id);


--
-- Name: candidates candidates_source_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.candidates
    ADD CONSTRAINT candidates_source_id_fkey FOREIGN KEY (source_id) REFERENCES leads.sources(id);


--
-- Name: crm_records crm_records_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_records
    ADD CONSTRAINT crm_records_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: crm_stage_history crm_stage_history_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.crm_stage_history
    ADD CONSTRAINT crm_stage_history_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: customer_service_history customer_service_history_customer_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.customer_service_history
    ADD CONSTRAINT customer_service_history_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES leads.customers(id) ON DELETE CASCADE;


--
-- Name: customers customers_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.customers
    ADD CONSTRAINT customers_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id);


--
-- Name: customers customers_crm_record_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.customers
    ADD CONSTRAINT customers_crm_record_id_fkey FOREIGN KEY (crm_record_id) REFERENCES leads.crm_records(id);


--
-- Name: dashboard_sessions dashboard_sessions_user_name_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.dashboard_sessions
    ADD CONSTRAINT dashboard_sessions_user_name_fkey FOREIGN KEY (user_name) REFERENCES leads.dashboard_users(name) ON DELETE CASCADE;


--
-- Name: discovery_runs discovery_runs_source_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.discovery_runs
    ADD CONSTRAINT discovery_runs_source_id_fkey FOREIGN KEY (source_id) REFERENCES leads.sources(id);


--
-- Name: inbound_replies inbound_replies_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.inbound_replies
    ADD CONSTRAINT inbound_replies_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id);


--
-- Name: notifications notifications_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.notifications
    ADD CONSTRAINT notifications_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id);


--
-- Name: opportunity_scores opportunity_scores_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.opportunity_scores
    ADD CONSTRAINT opportunity_scores_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: outreach_drafts outreach_drafts_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: mcp_engineer
--

ALTER TABLE ONLY leads.outreach_drafts
    ADD CONSTRAINT outreach_drafts_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: outreach_followups outreach_followups_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_followups
    ADD CONSTRAINT outreach_followups_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: outreach_queue outreach_queue_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.outreach_queue
    ADD CONSTRAINT outreach_queue_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: proposals proposals_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.proposals
    ADD CONSTRAINT proposals_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: proposals proposals_crm_record_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.proposals
    ADD CONSTRAINT proposals_crm_record_id_fkey FOREIGN KEY (crm_record_id) REFERENCES leads.crm_records(id);


--
-- Name: sales_timeline sales_timeline_candidate_id_fkey; Type: FK CONSTRAINT; Schema: leads; Owner: ivan
--

ALTER TABLE ONLY leads.sales_timeline
    ADD CONSTRAINT sales_timeline_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES leads.candidates(id) ON DELETE CASCADE;


--
-- Name: SCHEMA leads; Type: ACL; Schema: -; Owner: mcp_engineer
--

GRANT USAGE ON SCHEMA leads TO ivan;


--
-- Name: TABLE candidates; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.candidates TO ivan;


--
-- Name: SEQUENCE candidates_id_seq; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT SELECT,USAGE ON SEQUENCE leads.candidates_id_seq TO ivan;


--
-- Name: TABLE dashboard_sessions; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.dashboard_sessions TO ivan;


--
-- Name: TABLE dashboard_users; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.dashboard_users TO ivan;


--
-- Name: TABLE discovery_runs; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.discovery_runs TO ivan;


--
-- Name: SEQUENCE discovery_runs_id_seq; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT SELECT,USAGE ON SEQUENCE leads.discovery_runs_id_seq TO ivan;


--
-- Name: TABLE outreach_drafts; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.outreach_drafts TO ivan;


--
-- Name: SEQUENCE outreach_drafts_id_seq; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT SELECT,USAGE ON SEQUENCE leads.outreach_drafts_id_seq TO ivan;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.schema_migrations TO ivan;


--
-- Name: TABLE segments; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.segments TO ivan;


--
-- Name: SEQUENCE segments_id_seq; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT SELECT,USAGE ON SEQUENCE leads.segments_id_seq TO ivan;


--
-- Name: TABLE sources; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT ALL ON TABLE leads.sources TO ivan;


--
-- Name: SEQUENCE sources_id_seq; Type: ACL; Schema: leads; Owner: mcp_engineer
--

GRANT SELECT,USAGE ON SEQUENCE leads.sources_id_seq TO ivan;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: leads; Owner: mcp_engineer
--

ALTER DEFAULT PRIVILEGES FOR ROLE mcp_engineer IN SCHEMA leads GRANT SELECT,USAGE ON SEQUENCES TO ivan;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: leads; Owner: mcp_engineer
--

ALTER DEFAULT PRIVILEGES FOR ROLE mcp_engineer IN SCHEMA leads GRANT ALL ON TABLES TO ivan;


--
-- PostgreSQL database dump complete
--

\unrestrict YXVuFOM82RP4T2zrcfEpymCBlrTVRznjYf0BcmfijpnJ8EVmap2tOfshdEdGmIp

