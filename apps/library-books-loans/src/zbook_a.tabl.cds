@EndUserText.label : 'Library Book'
define table zbook_a {
  key client            : abap.clnt not null;
  key book_uuid         : sysuuid_x16 not null;
  title                 : abap.char(120);
  author                : abap.char(80);
  isbn                  : abap.char(17);
  genre                 : abap.char(30);
  copies                : abap.int4;
  created_by            : abp_creation_user;
  created_at            : abp_creation_tstmpl;
  last_changed_by       : abp_lastchange_user;
  last_changed_at       : abp_lastchange_tstmpl;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
