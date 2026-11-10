FUNCTION job_submit.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(AUTHCKNAM) TYPE  SYUNAME OPTIONAL
*"     VALUE(JOBCOUNT) TYPE  BTCJOBCNT
*"     VALUE(JOBNAME) TYPE  BTCJOB
*"     VALUE(REPORT) TYPE  SYREPID
*"     VALUE(VARIANT) TYPE  STRING OPTIONAL
*"  EXPORTING
*"     VALUE(STEP_NUMBER) TYPE  I
*"  EXCEPTIONS
*"      BAD_PRIPARAMS
*"      JOB_NOTEX
*"      JOB_SUBMIT_FAILED
*"      LOCK_FAILED
*"      PROGRAM_MISSING
*"----------------------------------------------------------------------
* implemented by the RAP Studio job scheduler (src/classic/jobs.mjs)
ENDFUNCTION.
