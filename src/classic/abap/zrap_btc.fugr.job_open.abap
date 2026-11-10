FUNCTION job_open.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(JOBNAME) TYPE  BTCJOB
*"     VALUE(JOBCLASS) TYPE  C OPTIONAL
*"     VALUE(SDLSTRTDT) TYPE  D OPTIONAL
*"     VALUE(SDLSTRTTM) TYPE  T OPTIONAL
*"  EXPORTING
*"     VALUE(JOBCOUNT) TYPE  BTCJOBCNT
*"  EXCEPTIONS
*"      CANT_CREATE_JOB
*"      INVALID_JOB_DATA
*"      JOBNAME_MISSING
*"----------------------------------------------------------------------
* implemented by the RAP Studio job scheduler (src/classic/jobs.mjs)
ENDFUNCTION.
