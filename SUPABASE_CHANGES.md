# Supabase Schema Changes - Student Profile Pictures

## 1. Update Students Table Schema

**Existing Table:** `students`

**New Column to Add:**
```sql
ALTER TABLE students
ADD COLUMN profile_picture_url TEXT DEFAULT NULL;
```

**Column Details:**
- **Column Name:** `profile_picture_url`
- **Type:** TEXT
- **Default:** NULL
- **Description:** URL of student's profile picture stored in Supabase Storage

---

## 2. Create Storage Bucket

**Create new public storage bucket for student profiles:**

1. Go to Supabase Dashboard
2. Navigate to **Storage** section
3. Click **Create a new bucket**
4. **Bucket name:** `student-profiles`
5. **Public/Private:** Set as **PUBLIC** (so URLs can be accessed without authentication)
6. Click **Create bucket**

---

## 3. Storage Bucket Settings

**Configure the bucket permissions:**

```
- Allow public read access (GET)
- Allow authenticated users to upload (POST)
- Allow authenticated users to delete their own files (DELETE)
```

### RLS Policy for student-profiles bucket:
```sql
-- Allow public read
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'student-profiles');

-- Allow authenticated upload
CREATE POLICY "Authenticated upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'student-profiles' AND auth.role() = 'authenticated');

-- Allow authenticated delete own files
CREATE POLICY "Authenticated delete own"
ON storage.objects FOR DELETE
USING (bucket_id = 'student-profiles' AND auth.uid()::text = owner);
```

---

## 4. SQL Migration Script (Safe)

**Run this SQL in Supabase SQL Editor:**

```sql
-- Add profile_picture_url column to students table
ALTER TABLE students
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add comment to the column
COMMENT ON COLUMN students.profile_picture_url IS 'URL of student profile picture stored in Supabase Storage';
```

---

## 5. File Upload Path Structure

**Files are uploaded to:** `student-profiles/{roll_no}-{timestamp}.{extension}`

**Example paths:**
- `student-profiles/CMGC-2026-001-1721041200000.jpg`
- `student-profiles/CMGC-2026-002-1721041250000.png`

**Public URL format:**
```
https://{SUPABASE_URL}/storage/v1/object/public/student-profiles/CMGC-2026-001-1721041200000.jpg
```

---

## 6. Frontend Code Integration

### StudentsList Component:
- ✅ Image upload field added (optional)
- ✅ File validation (image type, max 5MB)
- ✅ Upload to Supabase Storage before saving to DB
- ✅ Store URL in `profile_picture_url` column
- ✅ Display thumbnail in students table (40x50px)

### Overview Component:
- ✅ Display student profile picture in welcome section (100x130px)
- ✅ Picture appears only if `profile_picture_url` is not null

---

## 7. Data Flow

```
User selects image
    ↓
File validation (type, size)
    ↓
Upload to Storage: student-profiles/{roll_no}-{timestamp}.ext
    ↓
Get public URL from Supabase
    ↓
Save student record with profile_picture_url
    ↓
If no image selected: profile_picture_url remains NULL
```

---

## 8. Verification Steps

### Check if migration is complete:
```sql
-- View students table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'students'
ORDER BY ordinal_position;

-- Verify new column exists
SELECT * FROM students LIMIT 1;
```

---

## 9. Important Notes

✅ **Profile picture upload is OPTIONAL** - if not provided, NULL is stored
✅ **Max file size:** 5MB
✅ **Supported formats:** JPEG, PNG, GIF, WebP
✅ **Storage location:** Public bucket `student-profiles`
✅ **Access:** URLs are publicly accessible (no authentication required for viewing)
✅ **Null handling:** Database stores NULL if no picture is uploaded

---

## 10. Rollback (if needed)

If you need to revert these changes:

```sql
-- Remove the column
ALTER TABLE students
DROP COLUMN IF EXISTS profile_picture_url;

-- Delete the storage bucket (do this from UI)
-- Navigate to Storage → student-profiles → Delete bucket
```

---

## Summary

| Component | Change | Status |
|-----------|--------|--------|
| Students Table | Add `profile_picture_url` column | ✅ Required |
| Storage Bucket | Create `student-profiles` bucket | ✅ Required |
| RLS Policies | Configure public read access | ✅ Required |
| Frontend | Image upload & display | ✅ Implemented |

**Database schema is backward compatible** - existing students will have NULL values for profile_picture_url
