@EndUserText.label : 'Purchasing document types'
define table t161 {
  key mandt : abap.clnt not null;
  key bstyp : abap.char(1) not null;
  key bsart : abap.char(4) not null;
  numki     : abap.char(20);
  numke     : abap.char(20);
  batxt     : abap.char(40);
}
