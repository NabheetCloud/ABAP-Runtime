@EndUserText.label : 'Asset accounting settings per company code'
define table t093c {
  key mandt  : abap.clnt not null;
  key bukrs  : abap.char(4) not null;
  afapl      : abap.char(4);
  afaber     : abap.char(2);
}
