@EndUserText.label : 'Purchasing groups'
define table t024 {
  key mandt      : abap.clnt not null;
  key ekgrp      : abap.char(3) not null;
  eknam          : abap.char(18);
  tel_number     : abap.char(30);
  smtp_addr      : abap.char(241);
  ektel          : abap.char(20);
}
