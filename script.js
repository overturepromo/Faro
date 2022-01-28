/*
 *Author: Kevin Doss
 *Date: 08/19/2021
 *Description: Scheduled Script to send DDK100AU Sales Orders to DoorDash Australia WMS
 *http://ec2-3-25-220-193.ap-southeast-2.compute.amazonaws.com/MasterAgentApi/api/Orders
 */

function sendSO() {

	//define header object for nlapiRequestURL() call
	var header = {
    'Cache-Control' : 'no-cache',
		'Content-Type' : 'application/json',
		'Authorization':'9661B173-E407-4793-9BC3-E7896554DAE6'
	};

	//se: DDK100AU Orders Pending to WMS Australia
	var results = nlapiSearchRecord('salesorder','customsearch4743');

	if(results) {

    var checkGovernance = function() {

			var governanceThreshold = 500;
			var context = nlapiGetContext();

			if(context.getRemainingUsage() < governanceThreshold) {

				try{
					
					var script = nlapiScheduleScript('customscript_op_sched_ddk100auorders');

          if(script == 'QUEUED') {
            nlapiLogExecution('ERROR','Re-scheduling due to governance', 'Successful re-schedule.');
            return true;
          }
          else {
            nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
            return true;
          }
					
				}
				catch(e) {
					nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
					return true;
				}
			}
			else {
				return false;
			}

		};

    //check if ALL of the items are backordered
    var allBackordered = function(rec) {
      for(var i=1; i<=rec.getLineItemCount('item'); i++) {
        if(rec.getLineItemValue('item','quantitycommitted',i) > 0) {
          return false;
        }
      }
      return true;
    };

    var dateConversion = function(date) {
      //convert date to YYYY-MM-DDT00:00:00
      var dateObject = nlapiStringToDate(date);
      var dateMonth = null;
      var dateDay = null;
      if((dateObject.getMonth()+1).toString().length < 2) {
        dateMonth = '0'+(dateObject.getMonth()+1).toString();
      }
      else {
        dateMonth = (dateObject.getMonth()+1).toString();
      }
      if((dateObject.getDate()).toString().length < 2) {
        dateDay = '0'+(dateObject.getDate()).toString();
      }
      else {
        dateDay = (dateObject.getDate()).toString();
      }
      return dateObject.getFullYear()+'-'+dateMonth+'-'+dateDay+'T00:00:00';
    };

    for(var i = 0; i<results.length; i++) {

      try {

        var rec = null;
        var docNumber = null;
        var payload = {
          CustomerCode: 'DD',	
          CustomerName: '',
          Status: '',
          Warehouse: 'WH1',
          Reference: 'REF',
          OrderDate: '',
          DateWanted: '',
          JobReference: '',
          CustomerReference: '',
          CarrierCode: 'AUSPOST',
          CarrierName: '',
          TrackingNumber: '',
          Receiver:{
            Code: '',
            Name: '',
            Address: '',
            Suburb: '',
            StateCode: '',
            PostCode: '',
            CountryCode: '',
            Telephone: '',
            Email: ''
          },
          Instructions: '',
          Notes: '',
          CustomerOrderLines:[],
          ExtraCharges:0
        };

        var backorderedLines = {lines:[]};
        
        rec = nlapiLoadRecord('salesorder',results[i].getId());
        
        if(allBackordered(rec)) {
          docNumber = rec.getFieldValue('tranid')+'-BO';
          payload.CustomerReference = docNumber;
        }
        else {
          docNumber = rec.getFieldValue('tranid');
          payload.CustomerReference = rec.getFieldValue('tranid');
        }  

        payload.OrderDate = dateConversion(rec.getFieldValue('trandate'));
        //don't have in-hands dates on these, so just using trandate
        payload.DateWanted = dateConversion(rec.getFieldValue('trandate'));
        //per BDL, need to put email in JobReference
        payload.JobReference = rec.getFieldValue('custbody_customer_email');
        payload.Receiver.Name = rec.getFieldValue('shipattention');
        var shipAdd = rec.getFieldValue('shipaddr1');
        if(rec.getFieldValue('shipaddr2')) {
          shipAdd += '\r\n'+rec.getFieldValue('shipaddr2');
        }
        if(rec.getFieldValue('shipaddr3')) {
          shipAdd += '\r\n'+rec.getFieldValue('shipaddr3');
        }
        payload.Receiver.Address = shipAdd;
        
        payload.Receiver.Suburb = rec.getFieldValue('shipcity');
        payload.Receiver.StateCode = rec.getFieldValue('shipstate');
        payload.Receiver.PostCode = rec.getFieldValue('shipzip');
        payload.Receiver.CountryCode = rec.getFieldValue('shipcountry');
        payload.Receiver.Telephone = rec.getFieldValue('custbody_shiptophone');
        payload.Receiver.Email = rec.getFieldValue('custbody_customer_email');
        if(rec.getFieldValue('custbody_special_instructions') == '; UPS Account:') {
          payload.Instructions = '';
        }
        else {
          payload.Instructions = rec.getFieldValue('custbody_special_instructions');
        }
        

        for(var x=1; x<=rec.getLineItemCount('item'); x++) {
          var item = rec.getLineItemText('item','item',x);
          //check if backordered
          if(rec.getLineItemValue('item','quantitybackordered',x) < 1) {
            //exclude DDHAU-FRT and DDH-FRT
            if(rec.getLineItemValue('item','item',x) !== '337433' && rec.getLineItemValue('item','item',x) !== '215188'){
              //check if matrix item, strip out parent item if so
              if(item.indexOf(':') !== -1) {
                item = item.substring(item.indexOf(':')+2);
              }
              payload.CustomerOrderLines.push(
                {
                  ProductCode: item,
                  UOM: 'UNIT',
                  QtyOrdered: Number(rec.getLineItemValue('item','quantitycommitted',x))
                }
              );
            }
            
          }
          else {
            //check if matrix item, strip out parent item if so
            if(item.indexOf(':') !== -1) {
              item = item.substring(item.indexOf(':')+2);
            }
            backorderedLines.lines.push(
              {
                ProductCode: item,
                UOM: 'UNIT',
                QtyOrdered: Number(rec.getLineItemValue('item','quantitybackordered',x))
              }
            );
          }
        }

        if(payload.CustomerOrderLines.length > 0) {

          rec.setFieldValue('custbody_ariba_cxml_message',JSON.stringify(payload));
          nlapiLogExecution('AUDIT','Outbound Payload',JSON.stringify(payload));

          var response = nlapiRequestURL(
            'http://api-middleware.bdynamiclogistics.com.au/api/Orders',
            JSON.stringify(payload),
            header,
            null,
            'POST'
          );
  
          var resCode = response.getCode();
          var resBody = response.getBody();
          var resString = resCode+'\n'+JSON.stringify(resBody);
  
          nlapiLogExecution('AUDIT','WMS Response',resString);
  
          if(resCode === 200) {

            rec.setFieldValue('custbody_outbound_processing_complete','T');
  
            //if there are backordered lines
            //save them in custom field
            if(backorderedLines.lines.length > 0) {
              rec.setFieldValue('custbody_backordered_lines_pending','T');
              rec.setFieldValue('custbody_backordered_lines_data', JSON.stringify(backorderedLines));
              rec.setFieldValue('custbody_backorder_doc_number', rec.getFieldValue('tranid')+'-BO');
            }
  
            nlapiSubmitRecord(rec);
            nlapiLogExecution('AUDIT','SUCCESS',rec.getFieldValue('tranid')+' created successfully in WMS');

          }
  
          //else if errors are present, log them and email kevind@overturepromo.com
          else {
  
            nlapiLogExecution('ERROR','WMS Error',response.toString());
  
            nlapiSendEmail(
              '6',
              'kevind@overturepromo.com',
              'WMS Doordash Australia Error '+docNumber,
              docNumber+'\r\n'+resString,
              null,
              null,
              null,
              null
            );
            
            //still need to submit record to store outbound payload
            nlapiSubmitRecord(rec);
  
          }
        }
        //if no payload.items, all items are backordered
        else {
          rec.setFieldValue('custbody_backordered_lines_pending','T');
          rec.setFieldValue('custbody_backordered_lines_data', JSON.stringify(backorderedLines));
          rec.setFieldValue('custbody_backorder_doc_number', rec.getFieldValue('tranid')+'-BO');

          nlapiSubmitRecord(rec);
          nlapiLogExecution('AUDIT','All backorder order NOT sent.',rec.getFieldValue('tranid'));

        }

        if(i % 10 == 0) {
          if(checkGovernance() == true) {
            break;
          }	
        }
      }

      catch(e) {
        var error = e.code+' :: '+e.message;
        nlapiLogExecution('ERROR','Try / Catch Error',error);
        nlapiSendEmail(
          '6',
          'kevind@overturepromo.com',
          'WMS Doordash Australia Error Main Try/Catch Error',
          error.toString(),
          null,
          null,
          null,
          null
        );
      }
    }
		//callBackorderScript();
	}
}

