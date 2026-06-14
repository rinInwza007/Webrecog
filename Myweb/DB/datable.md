create table public.users (
  user_id uuid not null default gen_random_uuid (),
  email text not null,
  full_name text null,
  school_id text null,
  role text not null,
  password_hash text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  is_active boolean not null default true,
  status character varying(20) not null default 'active'::character varying,
  student_class character varying(20) null,
  academic_year character varying(10) null,
  face_enrolled boolean not null default false,
  last_face_seen_at timestamp with time zone null,
  last_login_at timestamp with time zone null,
  failed_login_count integer not null default 0,
  password_changed_at timestamp with time zone null,
  constraint users_pkey primary key (user_id),
  constraint users_email_key unique (email),
  constraint users_school_id_key unique (school_id),
  constraint chk_student_school_id check (
    (
      (role <> 'student'::text)
      or (school_id is not null)
    )
  ),
  constraint chk_user_status check (
    (
      (status)::text = any (
        (
          array[
            'active'::character varying,
            'inactive'::character varying,
            'graduated'::character varying,
            'suspended'::character varying
          ]
        )::text[]
      )
    )
  ),
  constraint users_role_check check (
    (
      role = any (
        array['student'::text, 'teacher'::text, 'admin'::text]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_users_email on public.users using btree (email) TABLESPACE pg_default;

create index IF not exists idx_users_role on public.users using btree (role) TABLESPACE pg_default;

create index IF not exists idx_users_school_id on public.users using btree (school_id) TABLESPACE pg_default;

create index IF not exists idx_users_active_students on public.users using btree (school_id, is_active) TABLESPACE pg_default
where
  (
    (role = 'student'::text)
    and (is_active = true)
  );

create index IF not exists idx_users_face_enrolled on public.users using btree (face_enrolled) TABLESPACE pg_default
where
  (face_enrolled = true);

create trigger trigger_update_users_updated_at BEFORE
update on users for EACH row
execute FUNCTION update_updated_at_column ();

create table public.student_face_enrollments (
  id serial not null,
  student_id character varying(50) not null,
  enrollment_type character varying(50) not null default 'standard'::character varying,
  system_version character varying(20) not null default '2.0.0'::character varying,
  motion_optimized boolean not null default false,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  total_embeddings integer not null default 0,
  original_count integer not null default 0,
  augmented_count integer not null default 0,
  avg_quality_score numeric(4, 3) null,
  avg_detection_score numeric(5, 4) null,
  enrollment_quality character varying(20) not null default 'unknown'::character varying,
  camera_id character varying(50) null,
  capture_distance_m numeric(4, 2) null default 1.00,
  lighting_condition character varying(30) null,
  embedding_model character varying(50) null,
  det_size character varying(20) null,
  padding_ratio numeric(4, 3) null,
  last_recognized_at timestamp with time zone null,
  recognition_count integer not null default 0,
  failed_count integer not null default 0,
  needs_reenroll boolean not null default false,
  enrolled_by character varying(50) null,
  constraint student_face_enrollments_pkey primary key (id),
  constraint fk_student_face_enrollments_student foreign KEY (student_id) references users (school_id) on delete CASCADE
) TABLESPACE pg_default;

create unique INDEX IF not exists uq_student_active_enrollment on public.student_face_enrollments using btree (student_id) TABLESPACE pg_default
where
  (is_active = true);

create index IF not exists idx_enrollments_quality on public.student_face_enrollments using btree (enrollment_quality) TABLESPACE pg_default
where
  (is_active = true);

create index IF not exists idx_enrollments_needs_reenroll on public.student_face_enrollments using btree (needs_reenroll) TABLESPACE pg_default
where
  (needs_reenroll = true);

create trigger trg_student_face_enrollments_updated_at BEFORE
update on student_face_enrollments for EACH row
execute FUNCTION update_updated_at_column ();

create trigger trg_sync_face_enrolled
after INSERT
or DELETE
or
update on student_face_enrollments for EACH row
execute FUNCTION sync_user_face_enrolled ();

create table public.student_face_embeddings (
  id serial not null,
  enrollment_id integer not null,
  student_id character varying(50) not null,
  pose character varying(30) not null,
  embedding_model character varying(50) not null,
  face_embedding public.vector not null,
  face_quality numeric(4, 3) not null default 0.000,
  blur_score numeric(6, 3) null,
  brightness_score numeric(6, 3) null,
  yaw_angle numeric(6, 2) null,
  pitch_angle numeric(6, 2) null,
  roll_angle numeric(6, 2) null,
  face_image_url text null,
  metadata_json jsonb null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  is_augmented boolean not null default false,
  augmentation_type character varying(50) null,
  augmentation_params jsonb null,
  simulated_distance_m numeric(4, 2) null,
  source_embedding_id integer null,
  detection_score numeric(5, 4) null,
  embedding_norm numeric(8, 6) null,
  is_active boolean not null default true,
  constraint student_face_embeddings_pkey primary key (id),
  constraint fk_face_embeddings_enrollment foreign KEY (enrollment_id) references student_face_enrollments (id) on delete CASCADE,
  constraint fk_face_embeddings_student foreign KEY (student_id) references users (school_id) on delete CASCADE,
  constraint student_face_embeddings_source_embedding_id_fkey foreign KEY (source_embedding_id) references student_face_embeddings (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_face_embeddings_student on public.student_face_embeddings using btree (student_id) TABLESPACE pg_default;

create index IF not exists idx_face_embeddings_enrollment on public.student_face_embeddings using btree (enrollment_id) TABLESPACE pg_default;

create index IF not exists idx_face_embeddings_pose on public.student_face_embeddings using btree (pose) TABLESPACE pg_default;

create index IF not exists idx_face_embeddings_model on public.student_face_embeddings using btree (embedding_model) TABLESPACE pg_default;

create unique INDEX IF not exists uq_enrollment_pose_aug on public.student_face_embeddings using btree (enrollment_id, pose, augmentation_type) NULLS not distinct TABLESPACE pg_default;

create index IF not exists idx_face_embeddings_original on public.student_face_embeddings using btree (student_id, is_augmented) TABLESPACE pg_default
where
  (is_augmented = false);

create index IF not exists idx_face_embeddings_active on public.student_face_embeddings using btree (student_id, is_active) TABLESPACE pg_default
where
  (is_active = true);

create index IF not exists idx_face_embeddings_vector_active on public.student_face_embeddings using ivfflat (face_embedding vector_cosine_ops)
with
  (lists = '100') TABLESPACE pg_default
where
  (is_active = true);

create trigger trg_student_face_embeddings_updated_at BEFORE
update on student_face_embeddings for EACH row
execute FUNCTION update_updated_at_column ();

create table public.student_enrollments (
  enrollment_id uuid not null default gen_random_uuid (),
  student_id uuid null,
  class_id uuid null,
  enrolled_at timestamp with time zone null default now(),
  status text null default 'active'::text,
  constraint student_enrollments_pkey primary key (enrollment_id),
  constraint student_enrollments_student_id_class_id_key unique (student_id, class_id),
  constraint student_enrollments_class_id_fkey foreign KEY (class_id) references classes (class_id) on delete CASCADE,
  constraint student_enrollments_student_id_fkey foreign KEY (student_id) references users (user_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_enrollments_class on public.student_enrollments using btree (class_id) TABLESPACE pg_default;

create index IF not exists idx_enrollments_student on public.student_enrollments using btree (student_id) TABLESPACE pg_default;

create view public.student_active_classes as
select
  class_id,
  subject_name,
  description,
  schedule,
  teacher_id,
  teacher_email,
  class_code,
  created_at,
  updated_at,
  deleted_at,
  is_deleted
from
  classes
where
  is_deleted = false;

  create table public.session_recognition_stats (
  id uuid not null default gen_random_uuid (),
  session_id uuid not null,
  total_detections integer not null default 0,
  total_recognized integer not null default 0,
  total_duplicate integer not null default 0,
  total_unrecognized integer not null default 0,
  duplicate_detail jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint session_recognition_stats_pkey primary key (id),
  constraint session_recognition_stats_session_id_fkey foreign KEY (session_id) references attendance_sessions (id) on delete CASCADE
) TABLESPACE pg_default;

create unique INDEX IF not exists uq_session_recognition_stats_session on public.session_recognition_stats using btree (session_id) TABLESPACE pg_default;

create table public.security_events (
  id uuid not null default gen_random_uuid (),
  session_id uuid null,
  student_email text null,
  event_type text not null,
  event_severity text null default 'medium'::text,
  description text null,
  metadata jsonb null,
  created_at timestamp with time zone null default now(),
  constraint security_events_pkey primary key (id),
  constraint fk_security_session foreign KEY (session_id) references attendance_sessions (id) on delete CASCADE,
  constraint fk_security_student foreign KEY (student_email) references users (email) on delete CASCADE,
  constraint event_type_check check (
    (
      event_type = any (
        array[
          'spoof_attempt'::text,
          'multiple_faces'::text,
          'screen_attack'::text,
          'camera_blocked'::text,
          'suspicious_behavior'::text,
          'unknown_face'::text,
          'fake_motion'::text
        ]
      )
    )
  ),
  constraint severity_check check (
    (
      event_severity = any (
        array[
          'low'::text,
          'medium'::text,
          'high'::text,
          'critical'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_security_events_session on public.security_events using btree (session_id) TABLESPACE pg_default;

create index IF not exists idx_security_events_student on public.security_events using btree (student_email) TABLESPACE pg_default;

create index IF not exists idx_security_events_created_at on public.security_events using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_security_events_type on public.security_events using btree (event_type) TABLESPACE pg_default;

create index IF not exists idx_security_session_type on public.security_events using btree (session_id, event_type) TABLESPACE pg_default;

create index IF not exists idx_security_severity_time on public.security_events using btree (event_severity, created_at desc) TABLESPACE pg_default;

create table public.motion_captures (
  id serial not null,
  session_id uuid not null,
  capture_time timestamp with time zone not null,
  capture_type character varying(50) not null,
  trigger_type character varying(50) not null,
  motion_strength numeric(5, 3) null default 0.0,
  processing_phase character varying(20) null,
  faces_detected integer null default 0,
  faces_recognized integer null default 0,
  new_records integer null default 0,
  processing_time_ms integer null default 0,
  processing_status character varying(30) null default 'pending'::character varying,
  block_reason character varying(100) null,
  queue_priority integer null default 5,
  device_id character varying(100) null,
  force_capture boolean null default false,
  error_message text null,
  created_at timestamp with time zone null default now(),
  optimization_version text null default 'v1'::text,
  attendance_records_created integer null default 0,
  session_duration_ms integer null,
  constraint motion_captures_pkey primary key (id),
  constraint fk_motion_captures_session_id foreign KEY (session_id) references attendance_sessions (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_motion_captures_capture_time on public.motion_captures using btree (capture_time) TABLESPACE pg_default;

create index IF not exists idx_motion_captures_processing_status on public.motion_captures using btree (processing_status) TABLESPACE pg_default;

create index IF not exists idx_motion_captures_session_id on public.motion_captures using btree (session_id) TABLESPACE pg_default;

create index IF not exists idx_motion_captures_session_capture on public.motion_captures using btree (session_id, capture_time desc) TABLESPACE pg_default;

create table public.liveness_detection_logs (
  id uuid not null default gen_random_uuid (),
  session_id uuid not null,
  name text not null default 'unknown_face'::text,
  detection_time timestamp with time zone null default now(),
  spoof_count integer not null default 0,
  constraint liveness_detection_logs_pkey primary key (id),
  constraint fk_liveness_session foreign KEY (session_id) references attendance_sessions (id) on delete CASCADE
) TABLESPACE pg_default;

create table public.classes (
  class_id uuid not null default gen_random_uuid (),
  subject_name text not null,
  description text null,
  schedule text null,
  teacher_id uuid null,
  teacher_email text not null,
  class_code text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  deleted_at timestamp with time zone null,
  is_deleted boolean not null default false,
  total_sessions integer null,
  max_checkins_per_week integer null,
  default_session_type text not null default 'standard'::text,
  default_on_time_limit_minutes integer not null default 30,
  attendance_settings_updated_at timestamp with time zone null default now(),
  default_duration_hours integer null default 1,
  actual_session_count integer not null default 0,
  enrolled_student_count integer not null default 0,
  deleted_by character varying(50) null,
  delete_reason text null,
  default_recognition_threshold numeric(4, 3) null default 0.400,
  default_det_size character varying(20) null default '1280x1280'::character varying,
  default_camera_id character varying(50) null,
  constraint classes_pkey primary key (class_id),
  constraint classes_class_code_key unique (class_code),
  constraint classes_teacher_id_fkey foreign KEY (teacher_id) references users (user_id) on delete CASCADE,
  constraint classes_default_session_type_check check (
    (
      default_session_type = any (array['standard'::text, 'motion_detection'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_classes_code on public.classes using btree (class_code) TABLESPACE pg_default;

create index IF not exists idx_classes_teacher_id on public.classes using btree (teacher_id) TABLESPACE pg_default;

create index IF not exists idx_classes_teacher_code on public.classes using btree (teacher_id, class_code) TABLESPACE pg_default;

create index IF not exists idx_classes_is_deleted on public.classes using btree (is_deleted) TABLESPACE pg_default
where
  (is_deleted = false);

create trigger trigger_update_classes_attendance_settings_at BEFORE
update on classes for EACH row
execute FUNCTION update_classes_attendance_settings_timestamp ();

create trigger trigger_update_classes_updated_at BEFORE
update on classes for EACH row
execute FUNCTION update_updated_at_column ();

create table public.class_enrollments (
  id uuid not null default gen_random_uuid (),
  class_id uuid not null,
  student_id text not null,
  enrolled_at timestamp with time zone not null default now(),
  enrolled_by character varying(50) null,
  is_active boolean not null default true,
  dropped_at timestamp with time zone null,
  drop_reason text null,
  constraint class_enrollments_pkey primary key (id),
  constraint uq_class_student unique (class_id, student_id),
  constraint class_enrollments_class_id_fkey foreign KEY (class_id) references classes (class_id) on delete CASCADE,
  constraint class_enrollments_student_id_fkey foreign KEY (student_id) references users (school_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_class_enrollments_class on public.class_enrollments using btree (class_id) TABLESPACE pg_default
where
  (is_active = true);

create index IF not exists idx_class_enrollments_student on public.class_enrollments using btree (student_id) TABLESPACE pg_default
where
  (is_active = true);

create trigger trg_sync_enrolled_count
after INSERT
or DELETE
or
update on class_enrollments for EACH row
execute FUNCTION sync_enrolled_student_count ();

create table public.attendance_sessions (
  id uuid not null default gen_random_uuid (),
  class_id uuid null,
  teacher_email text not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone null,
  on_time_limit_minutes integer null default 30,
  status text null default 'active'::text,
  session_type text null default 'standard'::text,
  motion_threshold numeric(3, 2) null default 0.1,
  cooldown_seconds integer null default 30,
  max_snapshots_per_hour integer null default 120,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  attendance_count integer null default 0,
  class_subject_name text null,
  class_description text null,
  class_code text null,
  session_number integer null,
  recognition_threshold numeric(4, 3) null default 0.400,
  det_size character varying(20) null default '1280x1280'::character varying,
  camera_id character varying(50) null,
  total_students integer not null default 0,
  present_count integer not null default 0,
  late_count integer not null default 0,
  absent_count integer not null default 0,
  avg_confidence numeric(5, 3) null,
  low_confidence_count integer not null default 0,
  constraint attendance_sessions_pkey primary key (id),
  constraint attendance_sessions_class_id_fkey foreign KEY (class_id) references classes (class_id) on delete set null,
  constraint attendance_sessions_session_type_check check (
    (
      session_type = any (array['standard'::text, 'motion_detection'::text])
    )
  ),
  constraint attendance_sessions_status_check check (
    (
      status = any (
        array['active'::text, 'ended'::text, 'cancelled'::text]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_sessions_class on public.attendance_sessions using btree (class_id) TABLESPACE pg_default;

create index IF not exists idx_sessions_active on public.attendance_sessions using btree (status, start_time desc) TABLESPACE pg_default
where
  (status = 'active'::text);

create trigger trg_sync_session_count
after INSERT
or DELETE
or
update on attendance_sessions for EACH row
execute FUNCTION sync_class_session_count ();

create trigger trigger_snapshot_class_info BEFORE INSERT on attendance_sessions for EACH row
execute FUNCTION snapshot_class_info_on_session ();

create trigger update_attendance_sessions_timestamp BEFORE
update on attendance_sessions for EACH row
execute FUNCTION update_attendance_sessions_timestamp ();

create table public.attendance_records (
  id uuid not null default gen_random_uuid (),
  session_id uuid null,
  student_email text not null,
  student_id text not null,
  check_in_time timestamp with time zone not null,
  status text not null,
  face_match_score numeric(5, 3) null,
  detection_method text null default 'manual'::text,
  processing_phase text null,
  face_quality numeric(3, 2) null default 1.0,
  motion_strength numeric(5, 3) null default 0.0,
  trigger_type text null default 'manual'::text,
  device_id text null,
  created_at timestamp with time zone null default now(),
  liveness_passed boolean null default true,
  liveness_score numeric(5, 3) null,
  final_confidence numeric(5, 3) null,
  recognition_distance_m numeric(4, 2) null,
  embedding_id integer null,
  augmentation_type_matched character varying(50) null,
  detection_score numeric(5, 4) null,
  faiss_rank smallint null,
  is_manual_override boolean not null default false,
  override_by character varying(50) null,
  override_reason text null,
  override_at timestamp with time zone null,
  constraint attendance_records_pkey primary key (id),
  constraint unique_attendance_per_session unique (session_id, student_email),
  constraint attendance_records_embedding_id_fkey foreign KEY (embedding_id) references student_face_embeddings (id) on delete set null,
  constraint attendance_records_session_id_fkey foreign KEY (session_id) references attendance_sessions (id) on delete CASCADE,
  constraint attendance_records_student_email_fkey foreign KEY (student_email) references users (email) on delete CASCADE,
  constraint attendance_records_status_check check (
    (
      status = any (
        array[
          'present'::text,
          'late'::text,
          'absent'::text,
          'leave'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_records_session on public.attendance_records using btree (session_id) TABLESPACE pg_default;

create index IF not exists idx_records_student on public.attendance_records using btree (student_email) TABLESPACE pg_default;

create index IF not exists idx_attendance_records_created_at on public.attendance_records using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_attendance_records_session_student on public.attendance_records using btree (session_id, student_email) TABLESPACE pg_default;

create trigger trigger_audit_attendance
after DELETE
or
update on attendance_records for EACH row
execute FUNCTION audit_attendance_changes ();

create trigger trigger_auto_attendance_status BEFORE INSERT on attendance_records for EACH row
execute FUNCTION auto_calculate_attendance_status ();

create trigger trigger_update_attendance_count
after INSERT
or DELETE on attendance_records for EACH row
execute FUNCTION update_attendance_count ();

create trigger trigger_validate_attendance BEFORE INSERT on attendance_records for EACH row
execute FUNCTION validate_attendance_record ();

create trigger trigger_validate_liveness BEFORE INSERT on attendance_records for EACH row
execute FUNCTION validate_liveness_detection ();

create trigger validate_attendance_status BEFORE INSERT
or
update on attendance_records for EACH row
execute FUNCTION validate_attendance_status ();

create view public.attendance_history_full as
select
  ar.id as record_id,
  ar.student_email,
  ar.student_id,
  ar.check_in_time,
  ar.status,
  ar.face_match_score,
  ar.liveness_passed,
  ar.final_confidence,
  ar.detection_score,
  ar.recognition_distance_m,
  ar.augmentation_type_matched,
  ar.is_manual_override,
  s.id as session_id,
  s.start_time as session_start,
  s.end_time as session_end,
  s.teacher_email,
  s.recognition_threshold,
  s.camera_id,
  COALESCE(c.subject_name, s.class_subject_name) as subject_name,
  COALESCE(c.description, s.class_description) as class_description,
  COALESCE(c.class_code, s.class_code) as class_code,
  s.class_id,
  c.class_id is null
  or c.is_deleted = true as class_is_deleted,
  case
    when ar.final_confidence >= 0.70 then 'high'::text
    when ar.final_confidence >= 0.50 then 'medium'::text
    else 'low'::text
  end as confidence_level
from
  attendance_records ar
  join attendance_sessions s on ar.session_id = s.id
  left join classes c on s.class_id = c.class_id;

  create table public.attendance_audit_logs (
  id uuid not null default gen_random_uuid (),
  attendance_id uuid null,
  action_type text null,
  old_status text null,
  new_status text null,
  changed_by text null,
  changed_at timestamp with time zone null default now(),
  old_data jsonb null,
  new_data jsonb null,
  constraint attendance_audit_logs_pkey primary key (id)
) TABLESPACE pg_default;