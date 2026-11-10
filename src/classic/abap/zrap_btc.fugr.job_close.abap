FUNCTION job_close.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(JOBCOUNT) TYPE  BTCJOBCNT
*"     VALUE(JOBNAME) TYPE  BTCJOB
*"     VALUE(PRDMINS) TYPE  I OPTIONAL
*"     VALUE(PRDHOURS) TYPE  I OPTIONAL
*"     VALUE(PRDDAYS) TYPE  I OPTIONAL
*"     VALUE(SDLSTRTDT) TYPE  D OPTIONAL
*"     VALUE(SDLSTRTTM) TYPE  T OPTIONAL
*"     VALUE(STRTIMMED) TYPE  C OPTIONAL
*"  EXPORTING
*"     VALUE(JOB_WAS_RELEASED) TYPE  C
*"  EXCEPTIONS
*"      CANT_START_IMMEDIATE
*"      INVALID_STARTDATE
*"      JOBNAME_MISSING
*"      JOB_CLOSE_FAILED
*"      JOB_NOSTEPS
*"      JOB_NOTEX
*"      LOCK_FAILED
*"----------------------------------------------------------------------
* implemented by the RAP Studio job scheduler (src/classic/jobs.mjs)
ENDFUNCTION.
