@EndUserText.label : 'Book Loan'
define table zloan_a {
  key client            : abap.clnt not null;
  key loan_uuid         : sysuuid_x16 not null;
  parent_uuid           : sysuuid_x16;
  member_name           : abap.char(80);
  member_email          : abap.char(120);
  loan_date             : abap.dats;
  due_date              : abap.dats;
  return_date           : abap.dats;
  receipt_pdf           : abap.rawstring(0);
  receipt_mimetype      : abap.char(128);
  receipt_filename      : abap.char(128);
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
