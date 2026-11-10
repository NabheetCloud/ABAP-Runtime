@EndUserText.label : 'Application log header'
define table balhdr {
  key mandt      : abap.clnt not null;
  key lognumber  : abap.char(20) not null;
  object         : abap.char(20);
  subobject      : abap.char(20);
  extnumber      : abap.char(20);
  aldate         : abap.dats;
  aluser         : abap.char(20);
  altcode        : abap.char(20);
  altime         : abap.tims;
  msg_cnt_al     : abap.int4;
}
