@EndUserText.label : 'Number range intervals'
define table nriv {
  key mandt      : abap.clnt not null;
  key object     : abap.char(20) not null;
  key subobject  : abap.char(20) not null;
  key nrrangenr  : abap.char(2) not null;
  key toyear     : abap.char(20) not null;
  fromnumber     : abap.char(20);
  tonumber       : abap.char(20);
  nrlevel        : abap.char(20);
  externind      : abap.char(20);
}
