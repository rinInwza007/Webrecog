create table public.class_grading_settings (
  id uuid not null default gen_random_uuid (),
  class_id uuid not null,
  present_score numeric(5, 2) not null default 1,
  late_score numeric(5, 2) not null default 0.5,
  leave_score numeric(5, 2) not null default 0.5,
  absent_score numeric(5, 2) not null default 0,
  max_attendance_score numeric(5, 2) not null default 20,
  updated_by uuid null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint class_grading_settings_pkey primary key (id),
  constraint class_grading_settings_class_id_key unique (class_id),
  constraint class_grading_settings_class_id_fkey foreign KEY (class_id) references classes (class_id) on delete CASCADE,
  constraint class_grading_settings_updated_by_fkey foreign KEY (updated_by) references users (user_id),
  constraint chk_scores_non_negative check (
    (
      (present_score >= (0)::numeric)
      and (late_score >= (0)::numeric)
      and (leave_score >= (0)::numeric)
      and (absent_score >= (0)::numeric)
      and (max_attendance_score > (0)::numeric)
    )
  )
) TABLESPACE pg_default;

create trigger set_updated_at BEFORE
update on class_grading_settings for EACH row
execute FUNCTION update_updated_at_column ();

create trigger trigger_update_class_grading_settings_updated_at BEFORE
update on class_grading_settings for EACH row
execute FUNCTION update_updated_at_column ();